const express = require('express');
const router = express.Router();
const { query, run, get } = require('../db/db');

// ========== 分类 ==========
router.get('/categories', async (req, res) => {
  try {
    const categories = await query('SELECT * FROM cloth_categories');
    res.json({ success: true, data: categories });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/categories', async (req, res) => {
  try {
    const { name, note } = req.body;
    const result = await run(
      'INSERT INTO cloth_categories (name, note) VALUES (?, ?)',
      [name, note]
    );
    res.json({ success: true, data: { id: result.lastID } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/categories/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, note } = req.body;
    await run(
      'UPDATE cloth_categories SET name = ?, note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [name, note, id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/categories/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await run('DELETE FROM cloth_categories WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ========== 品名（V24：合并规格，每行=品名+规格+尺寸） ==========
router.get('/names', async (req, res) => {
  try {
    const names = await query('SELECT * FROM cloth_names ORDER BY category_id, sort_order, id');
    for (const name of names) {
      const category = await get('SELECT * FROM cloth_categories WHERE id = ?', [name.category_id]);
      name.category_name = category ? category.name : '';
    }
    res.json({ success: true, data: names });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/names', async (req, res) => {
  try {
    const { name, spec, size, image, category_id, note, sort_order } = req.body;
    const result = await run(
      'INSERT INTO cloth_names (name, spec, size, image, category_id, note, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [name, spec || '', size || '', image || null, category_id, note, sort_order || 0]
    );
    res.json({ success: true, data: { id: result.lastID } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/names/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, spec, size, image, category_id, note, sort_order } = req.body;
    await run(
      'UPDATE cloth_names SET name = ?, spec = ?, size = ?, image = ?, category_id = ?, note = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [name, spec || '', size || '', image || null, category_id, note, sort_order || 0, id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/names/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await run('DELETE FROM cloth_names WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// V24: 兼容旧的 /specs 路径，从 cloth_names 中筛选 spec IS NOT NULL 的行返回
router.get('/specs', async (req, res) => {
  try {
    const specs = await query("SELECT id, name AS spec_name, size, image, category_id, '' AS name_id FROM cloth_names ORDER BY sort_order");
    res.json({ success: true, data: specs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ========== 客户清单（含 V25 name/size 字段） ==========
router.get('/products', async (req, res) => {
  try {
    const { customer_id, secondary_customer } = req.query;
    let sql = 'SELECT * FROM customer_products WHERE 1=1';
    let params = [];
    if (customer_id) {
      sql += ' AND customer_id = ?';
      params.push(customer_id);
    }
    if (secondary_customer !== undefined) {
      sql += ' AND secondary_customer = ?';
      params.push(secondary_customer);
    }
    sql += ' ORDER BY sort_order, id';
    const products = await query(sql, params);
    for (const product of products) {
      // V24: spec_id 现指向 cloth_names.id（含 spec/size/image）
      // V25: product.name / product.size 是 cloth_names 的副本，用于显示与编辑
      let clothNameObj = null;
      if (product.cloth_name_id) {
        clothNameObj = await get('SELECT * FROM cloth_names WHERE id = ?', [product.cloth_name_id]);
      }
      let specCloth = null;
      if (product.spec_id) {
        specCloth = await get('SELECT * FROM cloth_names WHERE id = ?', [product.spec_id]);
      }
      // 兼容 fallback：如果没 clothNameObj，用 specCloth 补
      if (!clothNameObj && specCloth) {
        clothNameObj = specCloth;
      }
      // 查分类：优先用表中已有的 category_name；否则从 cloth_names 推导
      if (!product.category_name && clothNameObj && clothNameObj.category_id) {
        const category = await get('SELECT * FROM cloth_categories WHERE id = ?', [clothNameObj.category_id]);
        product.category_name = category ? category.name : '';
      }
      // V25: 同步返回 name / size（用于前端展示与编辑）
      product.name = product.name || (clothNameObj ? clothNameObj.name : '');
      product.size = product.size || (specCloth ? specCloth.size : '');
    }
    res.json({ success: true, data: products });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// V25 辅助函数：从 cloth_names 自动填充 name/size/category_name/product_name
async function fillProductFromClothNames(product) {
  // 用 spec_id 查 cloth_names（含 spec/size），用 cloth_name_id 查 cloth_names.name
  let specCn = null;
  if (product.spec_id) {
    specCn = await get('SELECT name, spec, size, category_id FROM cloth_names WHERE id = ?', [product.spec_id]);
  }
  let nameCn = null;
  if (product.cloth_name_id) {
    nameCn = await get('SELECT name, spec, size, category_id FROM cloth_names WHERE id = ?', [product.cloth_name_id]);
  } else if (specCn) {
    nameCn = specCn;
  }
  // 自动填充 name（来自 cloth_names.name）
  if (!product.name && nameCn) {
    product.name = nameCn.name || '';
  }
  // 自动填充 size（来自 cloth_names.size，即 spec_id 对应行的 size）
  if (!product.size && specCn) {
    product.size = specCn.size || '';
  }
  // 自动填充 category_name（从 cloth_names.category_id 查 cloth_categories.name）
  if (!product.category_name && nameCn && nameCn.category_id) {
    const cat = await get('SELECT name FROM cloth_categories WHERE id = ?', [nameCn.category_id]);
    product.category_name = cat ? cat.name : '';
  }
  // 自动生成 product_name = alias + name + spec + size（如果未提供）
  if (!product.product_name) {
    const aliasText = (product.alias || '').trim();
    const nameText = (product.name || (nameCn && nameCn.name) || '').trim();
    const specText = (specCn && specCn.spec) || '';
    const sizeText = (product.size || (specCn && specCn.size) || '').trim();
    let generated = '';
    if (aliasText) generated += aliasText + ' ';
    generated += nameText;
    if (specText) generated += ' ' + specText;
    if (sizeText) generated += ' ' + sizeText;
    product.product_name = generated.trim();
  }
  return product;
}

router.post('/products', async (req, res) => {
  try {
    let product = req.body;
    product = await fillProductFromClothNames(product);
    const { customer_id, temp_customer, secondary_customer, category_name, name, spec_id, size, material, color, unit_price, alias, product_name, image, is_default, quantity, note, sort_order, cloth_name_id } = product;
    const result = await run(
      'INSERT INTO customer_products (customer_id, temp_customer, secondary_customer, category_name, name, spec_id, size, material, color, unit_price, alias, product_name, image, is_default, quantity, note, sort_order, cloth_name_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [customer_id, temp_customer, secondary_customer || '', category_name || '', name || '', spec_id || null, size || '', material, color, unit_price || 0, alias, product_name || null, image || null, is_default ? 1 : 0, quantity || 0, note, sort_order || 0, cloth_name_id || null]
    );
    res.json({ success: true, data: { id: result.lastID } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/products/:id', async (req, res) => {
  try {
    let product = req.body;
    product = await fillProductFromClothNames(product);
    const { id } = req.params;
    const { customer_id, temp_customer, secondary_customer, category_name, name, spec_id, size, material, color, unit_price, alias, product_name, image, is_default, quantity, note, sort_order, cloth_name_id } = product;
    await run(
      'UPDATE customer_products SET customer_id = ?, temp_customer = ?, secondary_customer = ?, category_name = ?, name = ?, spec_id = ?, size = ?, material = ?, color = ?, unit_price = ?, alias = ?, product_name = ?, image = ?, is_default = ?, quantity = ?, note = ?, sort_order = ?, cloth_name_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [customer_id, temp_customer, secondary_customer || '', category_name || '', name || '', spec_id || null, size || '', material, color, unit_price || 0, alias, product_name || null, image || null, is_default ? 1 : 0, quantity || 0, note, sort_order || 0, cloth_name_id || null, id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 清空全部客户清单（必须在 /:id 之前注册，避免 clear 被当作 id 参数）
router.delete('/products/clear', async (req, res) => {
  try {
    await run('DELETE FROM customer_products');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await run('DELETE FROM customer_products WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;