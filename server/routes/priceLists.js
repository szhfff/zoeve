const express = require('express');
const router = express.Router();
const { query, run, get } = require('../db/db');

/**
 * V27 优化：两级价格匹配策略
 * 第一优先级：精确匹配 (price_list_id, category_id, spec_id)
 * 第二优先级：品类兜底 (price_list_id, category_id, spec_id IS NULL)
 */

// 获取价目表列表（支持关联明细）
router.get('/', async (req, res) => {
  try {
    const { customer_id } = req.query;
    let sql = 'SELECT * FROM price_lists';
    let params = [];
    if (customer_id) {
      sql += ' WHERE customer_id = ?';
      params.push(customer_id);
    }
    const priceLists = await query(sql, params);
    for (const pl of priceLists) {
      pl.items = await query('SELECT * FROM price_list_items WHERE price_list_id = ?', [pl.id]);
      for (const item of pl.items) {
        const category = await get('SELECT * FROM cloth_categories WHERE id = ?', [item.category_id]);
        // V24: spec_id 现指向 cloth_names.id（含 spec/size/name）
        const cloth = item.spec_id ? await get('SELECT name, spec, size FROM cloth_names WHERE id = ?', [item.spec_id]) : null;
        // V26: 关联客户清单表
        const cp = item.customer_products_id ? await get('SELECT product_name FROM customer_products WHERE id = ?', [item.customer_products_id]) : null;
        item.category_name = category ? category.name : '';
        item.cloth_name = cloth ? cloth.name : '';
        item.spec_name = cloth ? cloth.spec : '';
        item.size_name = cloth ? cloth.size : '';
        item.customer_product_name = cp ? cp.product_name : '';
        // V27: 标记是否为品类通用价（spec_id 为 NULL）
        item.is_category_default = item.spec_id === null;
      }
    }
    res.json({ success: true, data: priceLists });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// V27 新增：智能查询价格（两级匹配）
router.get('/price/lookup', async (req, res) => {
  try {
    const { price_list_id, category_id, spec_id } = req.query;
    
    if (!price_list_id || !category_id) {
      return res.status(400).json({ 
        success: false, 
        message: '缺少必需参数：price_list_id 和 category_id' 
      });
    }

    // 第一优先级：精确匹配（spec_id 不为 NULL）
    let exactMatch = null;
    if (spec_id && spec_id !== 'null' && spec_id !== '') {
      exactMatch = await get(
        'SELECT * FROM price_list_items WHERE price_list_id = ? AND category_id = ? AND spec_id = ?',
        [price_list_id, category_id, spec_id]
      );
    }

    // 如果精确匹配成功，直接返回
    if (exactMatch) {
      const category = await get('SELECT name FROM cloth_categories WHERE id = ?', [exactMatch.category_id]);
      const cloth = exactMatch.spec_id ? await get('SELECT name, spec, size FROM cloth_names WHERE id = ?', [exactMatch.spec_id]) : null;
      return res.json({
        success: true,
        data: {
          ...exactMatch,
          category_name: category ? category.name : '',
          cloth_name: cloth ? cloth.name : '',
          spec_name: cloth ? cloth.spec : '',
          size_name: cloth ? cloth.size : '',
          match_type: 'exact',  // 精确匹配
          is_category_default: false
        }
      });
    }

    // 第二优先级：品类兜底（spec_id IS NULL）
    const categoryDefault = await get(
      'SELECT * FROM price_list_items WHERE price_list_id = ? AND category_id = ? AND spec_id IS NULL',
      [price_list_id, category_id]
    );

    if (categoryDefault) {
      const category = await get('SELECT name FROM cloth_categories WHERE id = ?', [categoryDefault.category_id]);
      return res.json({
        success: true,
        data: {
          ...categoryDefault,
          category_name: category ? category.name : '',
          cloth_name: null,
          spec_name: null,
          size_name: null,
          match_type: 'category_default',  // 品类通用价
          is_category_default: true
        }
      });
    }

    // 未找到匹配价格
    return res.json({
      success: true,
      data: null,
      message: '未找到匹配的价格记录'
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 创建价目表
router.post('/', async (req, res) => {
  try {
    const { customer_id, name, start_time, end_time, items } = req.body;
    const result = await run(
      'INSERT INTO price_lists (customer_id, name, start_time, end_time) VALUES (?, ?, ?, ?)',
      [customer_id, name, start_time, end_time || '']
    );
    const priceListId = result.lastID;
    if (items && items.length > 0) {
      for (const item of items) {
        // V27: spec_id 允许为 NULL（品类通用价）
        await run(
          'INSERT INTO price_list_items (price_list_id, category_id, spec_id, wash_price, customer_products_id) VALUES (?, ?, ?, ?, ?)',
          [priceListId, item.category_id, item.spec_id || null, item.wash_price, item.customer_products_id || null]
        );
      }
    }
    res.json({ success: true, data: { id: priceListId } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 更新价目表
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, start_time, end_time, items } = req.body;
    await run(
      'UPDATE price_lists SET name = ?, start_time = ?, end_time = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [name, start_time, end_time || '', id]
    );
    await run('DELETE FROM price_list_items WHERE price_list_id = ?', [id]);
    if (items && items.length > 0) {
      for (const item of items) {
        // V27: spec_id 允许为 NULL（品类通用价）
        await run(
          'INSERT INTO price_list_items (price_list_id, category_id, spec_id, wash_price, customer_products_id) VALUES (?, ?, ?, ?, ?)',
          [id, item.category_id, item.spec_id || null, item.wash_price, item.customer_products_id || null]
        );
      }
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 删除价目表
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await run('DELETE FROM price_lists WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
