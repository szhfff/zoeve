const express = require('express');
const router = express.Router();
const { query, run, get } = require('../db/db');

// GET /api/roles — 获取所有角色定义
router.get('/', async (req, res) => {
  try {
    const roles = await query('SELECT role_key, label, user_type, builtin, absolute FROM roles ORDER BY builtin DESC, id ASC');
    res.json({ success: true, data: roles });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/roles — 创建自定义角色
router.post('/', async (req, res) => {
  try {
    const { label, user_type } = req.body;
    if (!label || !label.trim()) {
      return res.status(400).json({ success: false, message: '角色名称不能为空' });
    }
    const type = (user_type === 'customer') ? 'customer' : 'company';
    const role_key = 'custom_' + Date.now();
    await run(
      'INSERT INTO roles (role_key, label, user_type, builtin, absolute) VALUES (?, ?, ?, 0, 0)',
      [role_key, label.trim(), type]
    );
    res.json({ success: true, data: { role_key, label: label.trim(), user_type: type, builtin: 0, absolute: 0 } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/roles/:key — 删除自定义角色（级联删除其权限授权）
router.delete('/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const role = await get('SELECT * FROM roles WHERE role_key = ?', [key]);
    if (!role) {
      return res.status(404).json({ success: false, message: '角色不存在' });
    }
    if (role.builtin) {
      return res.status(400).json({ success: false, message: '内置角色不可删除' });
    }
    await run('DELETE FROM role_grants WHERE role_key = ?', [key]);
    await run('DELETE FROM roles WHERE role_key = ?', [key]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/roles/grants/all — 获取所有角色的权限授权（用于前端启动时缓存）
router.get('/grants/all', async (req, res) => {
  try {
    const grants = await query('SELECT role_key, user_type, path FROM role_grants');
    res.json({ success: true, data: grants });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/roles/grants/:userType/:roleKey — 获取指定角色的权限授权
router.get('/grants/:userType/:roleKey', async (req, res) => {
  try {
    const { userType, roleKey } = req.params;
    const grants = await query('SELECT path FROM role_grants WHERE role_key = ? AND user_type = ?', [roleKey, userType]);
    res.json({ success: true, data: grants.map(g => g.path) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/roles/grants — 保存指定角色的权限授权（整体替换）
router.post('/grants', async (req, res) => {
  try {
    const { user_type, role_key, paths } = req.body;
    if (!role_key) {
      return res.status(400).json({ success: false, message: 'role_key 不能为空' });
    }
    const type = (user_type === 'customer') ? 'customer' : 'company';
    const pathList = Array.isArray(paths) ? paths : [];

    // 先删除旧授权，再插入新授权（整体替换）
    await run('DELETE FROM role_grants WHERE role_key = ? AND user_type = ?', [role_key, type]);
    for (const p of pathList) {
      if (p && typeof p === 'string') {
        await run(
          'INSERT OR IGNORE INTO role_grants (role_key, user_type, path) VALUES (?, ?, ?)',
          [role_key, type, p]
        );
      }
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
