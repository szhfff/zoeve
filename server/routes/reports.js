const express = require('express');
const router = express.Router();
const { query, get } = require('../db/db');

// GET /api/reports/customer — 客户对账表
// 参数: customer_id (可选，不传=全部), start_date, end_date
router.get('/customer', async (req, res) => {
  try {
    const { customer_id, start_date, end_date } = req.query;
    let sql = `
      SELECT wo.id AS order_id, wo.order_no, wo.customer_id, c.short_name AS customer_name,
             wo.secondary_customer, wo.status, wo.collect_time, wo.forecast_time, wo.created_at,
             wo.note,
             (SELECT COUNT(*) FROM wash_order_items WHERE order_id = wo.id) AS item_count,
             (SELECT COALESCE(SUM(billing_quantity), 0) FROM wash_order_items WHERE order_id = wo.id) AS total_billing_qty,
             (SELECT COALESCE(SUM(total_price), 0) FROM wash_order_items WHERE order_id = wo.id) AS total_amount,
             COALESCE(os.paid_amount, 0) AS paid_amount,
             COALESCE(os.status, 'unsettled') AS settlement_status,
             COALESCE(os.id, NULL) AS settlement_id
      FROM wash_orders wo
      LEFT JOIN customers c ON wo.customer_id = c.id
      LEFT JOIN order_settlements os ON os.order_id = wo.id
      WHERE 1=1
    `;
    const params = [];
    if (customer_id) { sql += ' AND wo.customer_id = ?'; params.push(customer_id); }
    if (start_date && end_date) {
      sql += ' AND (wo.collect_time BETWEEN ? AND ? OR wo.forecast_time BETWEEN ? AND ? OR wo.created_at BETWEEN ? AND ?)';
      params.push(start_date, end_date, start_date, end_date, start_date, end_date);
    }
    sql += ' ORDER BY wo.id DESC';
    const rows = await query(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/reports/revenue — 总营收报表
// 参数: start_date, end_date, group_by (day | customer | product)
router.get('/revenue', async (req, res) => {
  try {
    const { start_date, end_date, group_by, customer_id } = req.query;
    const dateFilter = start_date && end_date
      ? 'AND (wo.collect_time BETWEEN ? AND ? OR wo.forecast_time BETWEEN ? AND ? OR wo.created_at BETWEEN ? AND ?)'
      : '';
    const dateParams = start_date && end_date ? [start_date, end_date, start_date, end_date, start_date, end_date] : [];
    const custFilter = customer_id ? 'AND wo.customer_id = ?' : '';
    const custParams = customer_id ? [customer_id] : [];

    let sql = '';
    if (group_by === 'day') {
      sql = `
        SELECT DATE(COALESCE(wo.collect_time, wo.forecast_time, wo.created_at)) AS date_key,
               COUNT(DISTINCT wo.id) AS order_count,
               COALESCE(SUM(wi.billing_quantity), 0) AS total_qty,
               COALESCE(SUM(wi.total_price), 0) AS total_amount
        FROM wash_orders wo
        LEFT JOIN wash_order_items wi ON wi.order_id = wo.id
        WHERE 1=1 ${dateFilter} ${custFilter}
        GROUP BY date_key
        ORDER BY date_key ASC
      `;
    } else if (group_by === 'customer') {
      sql = `
        SELECT wo.customer_id, c.short_name AS customer_name,
               COUNT(DISTINCT wo.id) AS order_count,
               COALESCE(SUM(wi.billing_quantity), 0) AS total_qty,
               COALESCE(SUM(wi.total_price), 0) AS total_amount
        FROM wash_orders wo
        LEFT JOIN wash_order_items wi ON wi.order_id = wo.id
        LEFT JOIN customers c ON wo.customer_id = c.id
        WHERE 1=1 ${dateFilter} ${custFilter}
        GROUP BY wo.customer_id, c.short_name
        ORDER BY total_amount DESC
      `;
    } else if (group_by === 'product') {
      sql = `
        SELECT wi.product_id, cp.product_name,
               COUNT(DISTINCT wo.id) AS order_count,
               COALESCE(SUM(wi.billing_quantity), 0) AS total_qty,
               COALESCE(SUM(wi.total_price), 0) AS total_amount,
               wo.customer_id, c.short_name AS customer_name
        FROM wash_order_items wi
        JOIN wash_orders wo ON wi.order_id = wo.id
        LEFT JOIN customer_products cp ON wi.product_id = cp.id
        LEFT JOIN customers c ON wo.customer_id = c.id
        WHERE 1=1 ${dateFilter} ${custFilter}
        GROUP BY wi.product_id, cp.product_name
        ORDER BY total_amount DESC
      `;
    } else {
      // 汇总
      sql = `
        SELECT COUNT(DISTINCT wo.id) AS order_count,
               COALESCE(SUM(wi.billing_quantity), 0) AS total_qty,
               COALESCE(SUM(wi.total_price), 0) AS total_amount,
               COUNT(DISTINCT wo.customer_id) AS customer_count
        FROM wash_orders wo
        LEFT JOIN wash_order_items wi ON wi.order_id = wo.id
        WHERE 1=1 ${dateFilter} ${custFilter}
      `;
    }
    const rows = await query(sql, [...dateParams, ...custParams]);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/reports/order-detail — 订单明细（含价格）
// 参数: order_id
router.get('/order-detail', async (req, res) => {
  try {
    const { order_id } = req.query;
    if (!order_id) return res.status(400).json({ success: false, message: 'order_id 不能为空' });
    const items = await query(
      `SELECT wi.*, cp.product_name, cp.alias
       FROM wash_order_items wi
       LEFT JOIN customer_products cp ON wi.product_id = cp.id
       WHERE wi.order_id = ?
       ORDER BY wi.id ASC`,
      [order_id]
    );
    const totalAmount = items.reduce((s, i) => s + (i.total_price || 0), 0);
    const totalQty = items.reduce((s, i) => s + (i.billing_quantity || 0), 0);
    res.json({ success: true, data: { items, total_amount: totalAmount, total_billing_qty: totalQty } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/reports/analysis — 数据分析
// 参数: type (customer | product | price | trend), start_date, end_date
router.get('/analysis', async (req, res) => {
  try {
    const { type, start_date, end_date } = req.query;
    const dateFilter = start_date && end_date
      ? 'AND (wo.collect_time BETWEEN ? AND ? OR wo.forecast_time BETWEEN ? AND ? OR wo.created_at BETWEEN ? AND ?)'
      : '';
    const dateParams = start_date && end_date ? [start_date, end_date, start_date, end_date, start_date, end_date] : [];

    let sql = '';
    if (type === 'customer') {
      // 客户营收排名
      sql = `
        SELECT wo.customer_id, c.short_name AS customer_name,
               COUNT(DISTINCT wo.id) AS order_count,
               COALESCE(SUM(wi.billing_quantity), 0) AS total_qty,
               COALESCE(SUM(wi.total_price), 0) AS total_amount,
               CASE WHEN SUM(wi.billing_quantity) > 0 THEN SUM(wi.total_price) * 1.0 / SUM(wi.billing_quantity) ELSE 0 END AS avg_unit_price
        FROM wash_orders wo
        LEFT JOIN wash_order_items wi ON wi.order_id = wo.id
        LEFT JOIN customers c ON wo.customer_id = c.id
        WHERE 1=1 ${dateFilter}
        GROUP BY wo.customer_id, c.short_name
        ORDER BY total_amount DESC
        LIMIT 20
      `;
    } else if (type === 'product') {
      // 畅销产品 Top 20
      sql = `
        SELECT wi.product_id, cp.product_name,
               COUNT(DISTINCT wo.id) AS order_count,
               COALESCE(SUM(wi.billing_quantity), 0) AS total_qty,
               COALESCE(SUM(wi.total_price), 0) AS total_amount
        FROM wash_order_items wi
        JOIN wash_orders wo ON wi.order_id = wo.id
        LEFT JOIN customer_products cp ON wi.product_id = cp.id
        WHERE 1=1 ${dateFilter}
        GROUP BY wi.product_id, cp.product_name
        ORDER BY total_qty DESC
        LIMIT 20
      `;
    } else if (type === 'price') {
      // 无价格告警清单
      sql = `
        SELECT wi.id AS item_id, wo.order_no, wo.id AS order_id, c.short_name AS customer_name,
               cp.product_name, wi.forecast_quantity, wi.billing_quantity, wi.unit_price, wi.price_source
        FROM wash_order_items wi
        JOIN wash_orders wo ON wi.order_id = wo.id
        LEFT JOIN customer_products cp ON wi.product_id = cp.id
        LEFT JOIN customers c ON wo.customer_id = c.id
        WHERE wi.price_source = 'none' OR wi.unit_price = 0 OR wi.unit_price IS NULL
        ${dateFilter}
        ORDER BY wo.id DESC
      `;
    } else if (type === 'trend') {
      // 月度营收趋势
      sql = `
        SELECT strftime('%Y-%m', COALESCE(wo.collect_time, wo.forecast_time, wo.created_at)) AS month_key,
               COUNT(DISTINCT wo.id) AS order_count,
               COALESCE(SUM(wi.billing_quantity), 0) AS total_qty,
               COALESCE(SUM(wi.total_price), 0) AS total_amount
        FROM wash_orders wo
        LEFT JOIN wash_order_items wi ON wi.order_id = wo.id
        WHERE 1=1 ${dateFilter}
        GROUP BY month_key
        ORDER BY month_key ASC
      `;
    } else {
      return res.status(400).json({ success: false, message: 'type 参数无效（customer/product/price/trend）' });
    }
    const rows = await query(sql, dateParams);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
