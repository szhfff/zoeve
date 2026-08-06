const express = require('express');
const router = express.Router();
const { query, run, get } = require('../db/db');

// GET /api/settlements — 查询结算记录
// 参数: order_id (可选), status (可选)
router.get('/', async (req, res) => {
  try {
    const { order_id, status } = req.query;
    let sql = 'SELECT * FROM order_settlements WHERE 1=1';
    const params = [];
    if (order_id) { sql += ' AND order_id = ?'; params.push(order_id); }
    if (status) { sql += ' AND status = ?'; params.push(status); }
    sql += ' ORDER BY id DESC';
    const rows = await query(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/settlements/:orderId — 查询指定订单的结算
router.get('/:orderId', async (req, res) => {
  try {
    const row = await get('SELECT * FROM order_settlements WHERE order_id = ?', [req.params.orderId]);
    res.json({ success: true, data: row });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/settlements — 创建/更新结算（upsert by order_id）
router.post('/', async (req, res) => {
  try {
    const { order_id, settlement_date, total_amount, paid_amount, status, note } = req.body;
    if (!order_id) return res.status(400).json({ success: false, message: 'order_id 不能为空' });

    const existing = await get('SELECT id FROM order_settlements WHERE order_id = ?', [order_id]);
    const diff = (total_amount || 0) - (paid_amount || 0);
    const finalStatus = status || (diff <= 0 ? 'settled' : (paid_amount > 0 ? 'partial' : 'unsettled'));

    if (existing) {
      await run(
        `UPDATE order_settlements SET settlement_date = ?, total_amount = ?, paid_amount = ?, difference = ?, status = ?, note = ?
         WHERE order_id = ?`,
        [settlement_date || new Date().toISOString().slice(0, 10), total_amount || 0, paid_amount || 0, diff, finalStatus, note || '', order_id]
      );
      res.json({ success: true, data: { id: existing.id } });
    } else {
      const result = await run(
        `INSERT INTO order_settlements (order_id, settlement_date, total_amount, paid_amount, difference, status, note)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [order_id, settlement_date || new Date().toISOString().slice(0, 10), total_amount || 0, paid_amount || 0, diff, finalStatus, note || '']
      );
      res.json({ success: true, data: { id: result.lastID } });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/settlements/:orderId — 删除结算
router.delete('/:orderId', async (req, res) => {
  try {
    await run('DELETE FROM order_settlements WHERE order_id = ?', [req.params.orderId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
