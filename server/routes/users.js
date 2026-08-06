const express = require('express');
const router = express.Router();
const { query, run, get } = require('../db/db');

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await get('SELECT * FROM users WHERE username = ? AND password = ?', [username, password]);
    if (user) {
      res.json({ success: true, data: user });
    } else {
      res.json({ success: false, message: '用户名或密码错误' });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const users = await query('SELECT * FROM users');
    res.json({ success: true, data: users });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { username, password, role, name, wechat, fingerprint } = req.body;
    const result = await run(
      'INSERT INTO users (username, password, role, name, wechat, fingerprint) VALUES (?, ?, ?, ?, ?, ?)',
      [username, password, role, name, wechat || 0, fingerprint || 0]
    );
    res.json({ success: true, data: { id: result.lastID } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { username, password, role, name, wechat, fingerprint } = req.body;
    await run(
      'UPDATE users SET username = ?, password = ?, role = ?, name = ?, wechat = ?, fingerprint = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [username, password, role, name, wechat || 0, fingerprint || 0, id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await run('DELETE FROM users WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;