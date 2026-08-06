const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'zoeve.db');
const INIT_SQL_PATH = path.join(__dirname, 'init.sql');

let db = null;

function initDatabase() {
  return new Promise((resolve, reject) => {
    try {
      const dbExists = fs.existsSync(DB_PATH);
      db = new DatabaseSync(DB_PATH);

      if (!dbExists) {
        const initSql = fs.readFileSync(INIT_SQL_PATH, 'utf8');
        db.exec(initSql);
        console.log('Database initialized with sample data');
      } else {
        console.log('Database connected');
      }

      runMigrations();
      resolve(db);
    } catch (err) {
      reject(err);
    }
  });
}

function runMigrations() {
  // V21: 客户清单表双主键 - 添加 secondary_customer 字段
  safeAlter('customer_products', 'secondary_customer', "TEXT DEFAULT ''");
  // 确保双主键索引存在
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_customer_products_dual_key ON customer_products(customer_id, secondary_customer)'); } catch (e) {}

  // V22: 添加 cloth_name_id 字段
  safeAlter('customer_products', 'cloth_name_id', 'INTEGER REFERENCES cloth_names(id) ON DELETE SET NULL');
  // V23: 添加 product_name 字段
  safeAlter('customer_products', 'product_name', 'TEXT');
  // V24: 客户表添加 secondary_customer_id 字段
  safeAlter('customers', 'secondary_customer_id', 'TEXT');
  // V24: cloth_names 添加 spec/size/image 字段
  safeAlter('cloth_names', 'spec', "TEXT DEFAULT ''");
  safeAlter('cloth_names', 'size', "TEXT DEFAULT ''");
  safeAlter('cloth_names', 'image', 'TEXT');

  // V24: 将 cloth_specs 数据迁移到 cloth_names
  migrateClothSpecsToClothNames();

  // V25: customer_products 添加 name 和 size 字段
  safeAlter('customer_products', 'name', "TEXT DEFAULT ''");
  safeAlter('customer_products', 'size', "TEXT DEFAULT ''");
  // V25: 回填已有 customer_products 记录的 name 和 size
  backfillCustomerProductsNameSize();

  // V26: price_list_items 添加 customer_products_id 字段
  safeAlter('price_list_items', 'customer_products_id', 'INTEGER REFERENCES customer_products(id) ON DELETE SET NULL');
  // V26: 回填已有 price_list_items 的 customer_products_id
  backfillPriceListItemsCustomerProductId();

  // V27: 角色体系迁移（roles + role_grants 表）
  migrateRolesTables();

  // V28: wash_order_items 价格快照字段 + order_settlements 表
  migrateOrderPricingTables();
}

function safeAlter(table, column, definition) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch (e) {
    if (!e.message.includes('duplicate column')) {
      console.log(`Migration note: ${table}.${column} may already exist:`, e.message);
    }
  }
}

// node:sqlite 的 run 返回 { lastInsertRowid, changes }，映射为旧接口的 { lastID, changes }
function query(sql, params = []) {
  return Promise.resolve(db.prepare(sql).all(...params));
}

function run(sql, params = []) {
  const result = db.prepare(sql).run(...params);
  return Promise.resolve({ lastID: result.lastInsertRowid, changes: result.changes });
}

function get(sql, params = []) {
  return Promise.resolve(db.prepare(sql).get(...params));
}

// V24 迁移：将 cloth_specs 数据迁移到 cloth_names
function migrateClothSpecsToClothNames() {
  let table;
  try {
    table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cloth_specs'").get();
  } catch (e) {
    console.log('V24 migration: cloth_specs table not found, skip migration');
    return;
  }
  if (!table) {
    console.log('V24 migration: cloth_specs table not found, skip migration');
    return;
  }

  let oldSpecs;
  try {
    oldSpecs = db.prepare('SELECT id, name_id, category_id, name AS spec_name, size, image FROM cloth_specs').all();
  } catch (e) {
    console.log('V24 migration: error reading cloth_specs:', e.message);
    return;
  }
  if (!oldSpecs || oldSpecs.length === 0) {
    console.log('V24 migration: no cloth_specs data to migrate');
    try { db.exec('DROP TABLE IF EXISTS cloth_specs'); } catch (e) {}
    return;
  }

  console.log(`V24 migration: migrating ${oldSpecs.length} cloth_specs rows...`);
  const baseId = 100000;
  oldSpecs.forEach((spec, idx) => {
    const newId = baseId + idx;
    const origName = db.prepare('SELECT name FROM cloth_names WHERE id = ?').get(spec.name_id);
    const clothName = origName ? origName.name : '';
    try {
      db.prepare('INSERT OR IGNORE INTO cloth_names (id, name, spec, size, image, category_id, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(newId, clothName, spec.spec_name, spec.size || '', spec.image || null, spec.category_id, idx + 100);
      db.prepare('UPDATE customer_products SET spec_id = ? WHERE spec_id = ?').run(newId, spec.id);
      db.prepare('UPDATE base_price_lists SET spec_id = ? WHERE spec_id = ?').run(newId, spec.id);
      db.prepare('UPDATE price_list_items SET spec_id = ? WHERE spec_id = ?').run(newId, spec.id);
    } catch (insertErr) {
      console.log(`V24 migration error at idx ${idx}:`, insertErr.message);
    }
  });
  try {
    db.exec('DROP TABLE IF EXISTS cloth_specs');
    console.log('V24 migration: cloth_specs table dropped');
  } catch (dropErr) {
    console.log('V24 migration: drop cloth_specs failed:', dropErr.message);
  }
}

// V25 回填：从 cloth_names 填充 customer_products.name 和 size
function backfillCustomerProductsNameSize() {
  let rows;
  try {
    rows = db.prepare('SELECT id, cloth_name_id, spec_id FROM customer_products').all();
  } catch (e) {
    return;
  }
  if (!rows) return;
  rows.forEach(row => {
    const id = row.cloth_name_id || row.spec_id;
    if (!id) return;
    const cn = db.prepare('SELECT name, size FROM cloth_names WHERE id = ?').get(id);
    if (cn) {
      try {
        db.prepare('UPDATE customer_products SET name = ?, size = ? WHERE id = ? AND (name IS NULL OR name = "")')
          .run(cn.name || '', cn.size || '', row.id);
      } catch (e) {}
    }
  });
}

// V28 迁移：为 wash_order_items 添加价格快照字段 + 创建 order_settlements 表
function migrateOrderPricingTables() {
  const priceFields = [
    'unit_price REAL DEFAULT 0',
    'total_price REAL DEFAULT 0',
    'billing_quantity INTEGER DEFAULT 0',
    "price_source TEXT DEFAULT ''",
    'price_list_id INTEGER',
    'calculated_at DATETIME'
  ];
  priceFields.forEach(def => {
    const colName = def.split(' ')[0];
    safeAlter('wash_order_items', colName, def);
  });
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS order_settlements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      settlement_date DATE,
      total_amount REAL DEFAULT 0,
      paid_amount REAL DEFAULT 0,
      difference REAL DEFAULT 0,
      status TEXT DEFAULT 'unsettled',
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES wash_orders(id) ON DELETE CASCADE
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_order_settlements_order ON order_settlements(order_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_order_settlements_status ON order_settlements(status)');
  } catch (err) {
    if (!err.message.includes('duplicate')) {
      console.log('V28 migration: create order_settlements note:', err.message);
    }
  }
}

// V27 迁移：创建 roles / role_grants 表并种子内置角色
function migrateRolesTables() {
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role_key TEXT UNIQUE NOT NULL,
      label TEXT NOT NULL,
      user_type TEXT NOT NULL DEFAULT 'company',
      builtin INTEGER DEFAULT 0,
      absolute INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
  } catch (tErr) {
    if (!tErr.message.includes('duplicate')) {
      console.log('V27 migration: create roles table note:', tErr.message);
    }
  }
  const seedRoles = [
    ['superadmin', '超级管理员', 'company', 1, 1],
    ['admin', '系统管理员', 'company', 0, 0],
    ['statistician', '统计员', 'company', 0, 0],
    ['operator', '操作员', 'company', 0, 0]
  ];
  seedRoles.forEach(([key, label, type, builtin, absolute]) => {
    try {
      db.prepare('INSERT OR IGNORE INTO roles (role_key, label, user_type, builtin, absolute) VALUES (?, ?, ?, ?, ?)')
        .run(key, label, type, builtin, absolute);
    } catch (e) {}
  });

  try {
    db.exec(`CREATE TABLE IF NOT EXISTS role_grants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role_key TEXT NOT NULL,
      user_type TEXT NOT NULL DEFAULT 'company',
      path TEXT NOT NULL,
      UNIQUE(role_key, path)
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_role_grants_key ON role_grants(role_key)');
  } catch (gErr) {
    if (!gErr.message.includes('duplicate')) {
      console.log('V27 migration: create role_grants table note:', gErr.message);
    }
  }
}

// V26 回填：根据 price_lists.customer_id + cloth_categories 名称 + item.spec_id 匹配 customer_products.id
function backfillPriceListItemsCustomerProductId() {
  let items;
  try {
    items = db.prepare(`
      SELECT pli.id, pl.customer_id, cc.name AS category_name, pli.spec_id
      FROM price_list_items pli
      JOIN price_lists pl ON pli.price_list_id = pl.id
      LEFT JOIN cloth_categories cc ON pli.category_id = cc.id
      WHERE pli.customer_products_id IS NULL
    `).all();
  } catch (err) {
    return;
  }
  if (!items) return;
  items.forEach(item => {
    const cp = db.prepare('SELECT id FROM customer_products WHERE customer_id = ? AND category_name = ? AND spec_id = ? LIMIT 1')
      .get(item.customer_id, item.category_name || '', item.spec_id);
    if (cp && cp.id) {
      try {
        db.prepare('UPDATE price_list_items SET customer_products_id = ? WHERE id = ?').run(cp.id, item.id);
      } catch (e) {}
    }
  });
}

module.exports = {
  initDatabase,
  query,
  run,
  get,
  migrateClothSpecsToClothNames,
  backfillCustomerProductsNameSize,
  backfillPriceListItemsCustomerProductId,
  migrateRolesTables,
  migrateOrderPricingTables
};
