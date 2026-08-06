const express = require('express');
const router = express.Router();
const { query, run, get } = require('../db/db');

router.get('/', async (req, res) => {
  try {
    const { customer_id, start_date, end_date } = req.query;
    let sql = 'SELECT * FROM daily_records';
    let params = [];
    if (customer_id) {
      sql += ' WHERE customer_id = ?';
      params.push(customer_id);
    }
    if (start_date && end_date) {
      sql += customer_id ? ' AND' : ' WHERE';
      sql += ' date BETWEEN ? AND ?';
      params.push(start_date, end_date);
    }
    const records = await query(sql, params);
    for (const record of records) {
      const product = await get('SELECT * FROM customer_products WHERE id = ?', [record.product_id]);
      if (product) {
        // V24: spec_id 现指向 cloth_names.id（含 spec/size）
        const specCloth = product.spec_id ? await get('SELECT name, spec, size FROM cloth_names WHERE id = ?', [product.spec_id]) : null;
        record.product_name = product.alias || product.name || (specCloth && specCloth.name) || '';
        record.cloth_name = product.name || (specCloth && specCloth.name) || '';
        record.spec_name = specCloth ? specCloth.spec : '';
      }
    }
    res.json({ success: true, data: records });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { customer_id, product_id, quantity, date, note } = req.body;
    const result = await run(
      'INSERT INTO daily_records (customer_id, product_id, quantity, date, note) VALUES (?, ?, ?, ?, ?)',
      [customer_id, product_id, quantity, date, note]
    );
    res.json({ success: true, data: { id: result.lastID } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/batch', async (req, res) => {
  try {
    const records = req.body;
    for (const record of records) {
      await run(
        'INSERT INTO daily_records (customer_id, product_id, quantity, date, note) VALUES (?, ?, ?, ?, ?)',
        [record.customer_id, record.product_id, record.quantity, record.date, record.note]
      );
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/summary', async (req, res) => {
  try {
    const { customer_id, start_date, end_date } = req.query;
    let sql = `
      SELECT r.product_id, SUM(r.quantity) as total_quantity, 
             cp.alias, cp.material, cp.color, cp.unit_price
      FROM daily_records r
      LEFT JOIN customer_products cp ON r.product_id = cp.id
    `;
    let params = [];
    const conditions = [];
    if (customer_id) {
      conditions.push('r.customer_id = ?');
      params.push(customer_id);
    }
    if (start_date && end_date) {
      conditions.push('r.date BETWEEN ? AND ?');
      params.push(start_date, end_date);
    }
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' GROUP BY r.product_id';
    const summary = await query(sql, params);
    res.json({ success: true, data: summary });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;