const express = require('express');
const router = express.Router();
const { query, run, get } = require('../db/db');

// ===== 价格匹配核心算法 =====
// 给定 customer_id + 订单时间 + product_id，按优先级链查找单价
// 返回: { unit_price, price_source, price_list_id }
async function lookupPrice(customerId, orderTime, productId) {
  if (!customerId || !productId) return { unit_price: 0, price_source: 'none', price_list_id: null };

  // 取产品的 category_id 和 spec_id
  const product = await get(
    `SELECT cp.spec_id, cp.cloth_name_id, cp.unit_price, cn.category_id
     FROM customer_products cp
     LEFT JOIN cloth_names cn ON cp.spec_id = cn.id OR cp.cloth_name_id = cn.id
     WHERE cp.id = ?`,
    [productId]
  );
  if (!product) return { unit_price: 0, price_source: 'none', price_list_id: null };

  const specId = product.spec_id || product.cloth_name_id;
  const categoryId = product.category_id;
  // 订单时间为空时用当前时间
  const ordTime = orderTime || new Date().toISOString();

  // 1. 客户价目表精确匹配（spec_id 命中）
  if (specId && categoryId) {
    const exact = await get(
      `SELECT pli.wash_price, pl.id AS price_list_id
       FROM price_lists pl
       JOIN price_list_items pli ON pli.price_list_id = pl.id
       WHERE pl.customer_id = ?
         AND datetime(?) >= datetime(pl.start_time)
         AND (pl.end_time = '' OR pl.end_time IS NULL OR datetime(?) < datetime(pl.end_time))
         AND pli.category_id = ?
         AND pli.spec_id = ?
       ORDER BY pl.start_time DESC LIMIT 1`,
      [customerId, ordTime, ordTime, categoryId, specId]
    );
    if (exact && exact.wash_price != null) {
      return { unit_price: exact.wash_price, price_source: 'price_list', price_list_id: exact.price_list_id };
    }
  }

  // 2. 客户价目表品类兜底（spec_id IS NULL）
  if (categoryId) {
    const catFallback = await get(
      `SELECT pli.wash_price, pl.id AS price_list_id
       FROM price_lists pl
       JOIN price_list_items pli ON pli.price_list_id = pl.id
       WHERE pl.customer_id = ?
         AND datetime(?) >= datetime(pl.start_time)
         AND (pl.end_time = '' OR pl.end_time IS NULL OR datetime(?) < datetime(pl.end_time))
         AND pli.category_id = ?
         AND pli.spec_id IS NULL
       ORDER BY pl.start_time DESC LIMIT 1`,
      [customerId, ordTime, ordTime, categoryId]
    );
    if (catFallback && catFallback.wash_price != null) {
      return { unit_price: catFallback.wash_price, price_source: 'price_list_category', price_list_id: catFallback.price_list_id };
    }
  }

  // 3. 客户清单价
  if (product.unit_price != null && product.unit_price > 0) {
    return { unit_price: product.unit_price, price_source: 'customer_product', price_list_id: null };
  }

  // 4. 基准价兜底
  if (specId) {
    const base = await get('SELECT base_price FROM base_price_lists WHERE spec_id = ?', [specId]);
    if (base && base.base_price != null) {
      return { unit_price: base.base_price, price_source: 'base_price', price_list_id: null };
    }
  }

  return { unit_price: 0, price_source: 'none', price_list_id: null };
}

// 计费数量优先级：handover → completed → collect → forecast
function getBillingQuantity(item) {
  return item.handover_quantity || item.completed_quantity || item.collect_quantity || item.forecast_quantity || 0;
}

// 订单时间优先级：collect_time → forecast_time → created_at
async function getOrderTime(orderId) {
  const order = await get('SELECT collect_time, forecast_time, created_at FROM wash_orders WHERE id = ?', [orderId]);
  if (!order) return null;
  return order.collect_time || order.forecast_time || order.created_at || null;
}

// 给指定订单的所有明细计算价格并写入快照
async function calculateOrderPrices(orderId) {
  const orderTime = await getOrderTime(orderId);
  const order = await get('SELECT customer_id FROM wash_orders WHERE id = ?', [orderId]);
  if (!order) return { success: false, message: '订单不存在' };

  const items = await query('SELECT * FROM wash_order_items WHERE order_id = ?', [orderId]);
  const results = [];
  for (const item of items) {
    const priceInfo = await lookupPrice(order.customer_id, orderTime, item.product_id);
    const billingQty = getBillingQuantity(item);
    const totalPrice = (priceInfo.unit_price || 0) * billingQty;
    await run(
      `UPDATE wash_order_items
       SET unit_price = ?, total_price = ?, billing_quantity = ?, price_source = ?, price_list_id = ?, calculated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [priceInfo.unit_price, totalPrice, billingQty, priceInfo.price_source, priceInfo.price_list_id, item.id]
    );
    results.push({ item_id: item.id, ...priceInfo, billing_quantity: billingQty, total_price: totalPrice });
  }
  return { success: true, data: results };
}

// ===== 订单 CRUD =====

// GET /api/washorders — 获取所有订单（含明细）
router.get('/', async (req, res) => {
  try {
    const { customer_id, status, start_date, end_date } = req.query;
    let sql = 'SELECT * FROM wash_orders WHERE 1=1';
    const params = [];
    if (customer_id) { sql += ' AND customer_id = ?'; params.push(customer_id); }
    if (status) { sql += ' AND status = ?'; params.push(status); }
    if (start_date && end_date) {
      sql += ' AND (collect_time BETWEEN ? AND ? OR forecast_time BETWEEN ? AND ? OR created_at BETWEEN ? AND ?)';
      params.push(start_date, end_date, start_date, end_date, start_date, end_date);
    }
    sql += ' ORDER BY id DESC';
    const orders = await query(sql, params);
    // 附带明细
    for (const order of orders) {
      order.items = await query('SELECT * FROM wash_order_items WHERE order_id = ?', [order.id]);
    }
    res.json({ success: true, data: orders });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/washorders/:id — 获取单个订单
router.get('/:id', async (req, res) => {
  try {
    const order = await get('SELECT * FROM wash_orders WHERE id = ?', [req.params.id]);
    if (!order) return res.status(404).json({ success: false, message: '订单不存在' });
    order.items = await query('SELECT * FROM wash_order_items WHERE order_id = ?', [order.id]);
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/washorders — 创建订单（含明细），自动算价
router.post('/', async (req, res) => {
  try {
    const { order_no, customer_id, secondary_customer, status, forecast_user_id, forecast_time, forecast_confirmed, items, note } = req.body;
    if (!customer_id || !order_no) {
      return res.status(400).json({ success: false, message: 'customer_id 和 order_no 不能为空' });
    }
    const orderResult = await run(
      `INSERT INTO wash_orders (order_no, customer_id, secondary_customer, status, forecast_user_id, forecast_time, forecast_confirmed, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [order_no, customer_id, secondary_customer || '', status || 'forecast', forecast_user_id || null, forecast_time || null, forecast_confirmed || 0, note || '']
    );
    const orderId = orderResult.lastID;
    const itemIds = [];
    if (Array.isArray(items)) {
      for (const item of items) {
        const itemResult = await run(
          `INSERT INTO wash_order_items (order_id, product_id, forecast_quantity, collect_quantity, completed_quantity, remaining_quantity, handover_quantity, note)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [orderId, item.product_id, item.forecast_quantity || 0, item.collect_quantity || 0, item.completed_quantity || 0,
           item.remaining_quantity != null ? item.remaining_quantity : (item.forecast_quantity || 0), item.handover_quantity || 0, item.note || '']
        );
        itemIds.push(itemResult.lastID);
      }
      // 自动算价
      await calculateOrderPrices(orderId);
    }
    res.json({ success: true, data: { id: orderId, item_ids: itemIds } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/washorders/:id — 更新订单
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const fields = ['order_no', 'customer_id', 'secondary_customer', 'status', 'forecast_user_id', 'forecast_time',
      'forecast_confirmed', 'forecast_confirmed_by', 'forecast_confirmed_time',
      'collect_user_id', 'collect_time', 'collect_confirmed',
      'wash_user_id', 'wash_time', 'wash_confirmed',
      'handover_user_id', 'handover_time', 'handover_confirmed', 'handover_confirmed_by', 'handover_confirmed_time', 'note'];
    const updates = [];
    const params = [];
    fields.forEach(f => {
      if (req.body[f] !== undefined) { updates.push(`${f} = ?`); params.push(req.body[f]); }
    });
    updates.push("updated_at = CURRENT_TIMESTAMP");
    params.push(id);
    await run(`UPDATE wash_orders SET ${updates.join(', ')} WHERE id = ?`, params);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/washorders/:id — 删除订单（级联删除明细）
router.delete('/:id', async (req, res) => {
  try {
    await run('DELETE FROM wash_order_items WHERE order_id = ?', [req.params.id]);
    await run('DELETE FROM wash_operations WHERE order_id = ?', [req.params.id]);
    await run('DELETE FROM wash_orders WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/washorders — 清空所有订单
router.delete('/', async (req, res) => {
  try {
    await run('DELETE FROM wash_order_items');
    await run('DELETE FROM wash_operations');
    await run('DELETE FROM wash_orders');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ===== 订单明细 CRUD =====

// PUT /api/washorders/items/:itemId — 更新明细（数量变化后自动重算该明细价格）
router.put('/items/:itemId', async (req, res) => {
  try {
    const { itemId } = req.params;
    const fields = ['product_id', 'forecast_quantity', 'collect_quantity', 'completed_quantity',
      'remaining_quantity', 'handover_quantity', 'rewash_quantity', 'stain_removal_quantity', 'note',
      'unit_price', 'total_price', 'billing_quantity', 'price_source', 'price_list_id'];
    const updates = [];
    const params = [];
    fields.forEach(f => {
      if (req.body[f] !== undefined) { updates.push(`${f} = ?`); params.push(req.body[f]); }
    });
    if (updates.length === 0) return res.json({ success: true });
    updates.push("calculated_at = CURRENT_TIMESTAMP");
    params.push(itemId);
    await run(`UPDATE wash_order_items SET ${updates.join(', ')} WHERE id = ?`, params);

    // 如果数量相关字段变化，重算价格
    const qtyFields = ['forecast_quantity', 'collect_quantity', 'completed_quantity', 'handover_quantity', 'product_id'];
    const needRecalc = qtyFields.some(f => req.body[f] !== undefined);
    if (needRecalc) {
      const item = await get('SELECT order_id FROM wash_order_items WHERE id = ?', [itemId]);
      if (item) {
        const orderTime = await getOrderTime(item.order_id);
        const order = await get('SELECT customer_id FROM wash_orders WHERE id = ?', [item.order_id]);
        if (order) {
          const updatedItem = await get('SELECT * FROM wash_order_items WHERE id = ?', [itemId]);
          const priceInfo = await lookupPrice(order.customer_id, orderTime, updatedItem.product_id);
          const billingQty = getBillingQuantity(updatedItem);
          const totalPrice = (priceInfo.unit_price || 0) * billingQty;
          await run(
            `UPDATE wash_order_items SET unit_price = ?, total_price = ?, billing_quantity = ?, price_source = ?, price_list_id = ?, calculated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [priceInfo.unit_price, totalPrice, billingQty, priceInfo.price_source, priceInfo.price_list_id, itemId]
          );
        }
      }
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/washorders/items — 新增明细
router.post('/items', async (req, res) => {
  try {
    const { order_id, product_id, forecast_quantity, collect_quantity, completed_quantity, remaining_quantity, handover_quantity, note } = req.body;
    if (!order_id || !product_id) {
      return res.status(400).json({ success: false, message: 'order_id 和 product_id 不能为空' });
    }
    const result = await run(
      `INSERT INTO wash_order_items (order_id, product_id, forecast_quantity, collect_quantity, completed_quantity, remaining_quantity, handover_quantity, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [order_id, product_id, forecast_quantity || 0, collect_quantity || 0, completed_quantity || 0,
       remaining_quantity != null ? remaining_quantity : (forecast_quantity || 0), handover_quantity || 0, note || '']
    );
    // 算价
    const orderTime = await getOrderTime(order_id);
    const order = await get('SELECT customer_id FROM wash_orders WHERE id = ?', [order_id]);
    if (order) {
      const priceInfo = await lookupPrice(order.customer_id, orderTime, product_id);
      const billingQty = handover_quantity || completed_quantity || collect_quantity || forecast_quantity || 0;
      const totalPrice = (priceInfo.unit_price || 0) * billingQty;
      await run(
        `UPDATE wash_order_items SET unit_price = ?, total_price = ?, billing_quantity = ?, price_source = ?, price_list_id = ?, calculated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [priceInfo.unit_price, totalPrice, billingQty, priceInfo.price_source, priceInfo.price_list_id, result.lastID]
      );
    }
    res.json({ success: true, data: { id: result.lastID } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/washorders/items/:itemId — 删除明细
router.delete('/items/:itemId', async (req, res) => {
  try {
    await run('DELETE FROM wash_order_items WHERE id = ?', [req.params.itemId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/washorders/:id/recalc — 重算指定订单所有明细价格
router.post('/:id/recalc', async (req, res) => {
  try {
    const result = await calculateOrderPrices(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/washorders/recalc-all — 重算所有订单价格
router.post('/recalc-all', async (req, res) => {
  try {
    const orders = await query('SELECT id FROM wash_orders');
    let total = 0;
    for (const order of orders) {
      await calculateOrderPrices(order.id);
      total++;
    }
    res.json({ success: true, data: { recalculated: total } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
