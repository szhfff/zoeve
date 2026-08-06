const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'zoeve.db');
const INIT_SQL_PATH = path.join(__dirname, 'init.sql');

let db = null;

function initDatabase() {
  return new Promise((resolve, reject) => {
    const dbExists = fs.existsSync(DB_PATH);
    db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        reject(err);
        return;
      }
      
      const runMigrations = () => {
        // V21: 客户清单表双主键 - 添加 secondary_customer 字段
        db.run('ALTER TABLE customer_products ADD COLUMN secondary_customer TEXT DEFAULT \'\'', (alterErr) => {
          if (alterErr && !alterErr.message.includes('duplicate column')) {
            console.log('Migration note: secondary_customer column may already exist:', alterErr.message);
          }
        });
        // 确保双主键索引存在
        db.run('CREATE INDEX IF NOT EXISTS idx_customer_products_dual_key ON customer_products(customer_id, secondary_customer)', () => {});
        // V22: 添加 cloth_name_id 字段，修正品名-分类映射
        db.run('ALTER TABLE customer_products ADD COLUMN cloth_name_id INTEGER REFERENCES cloth_names(id) ON DELETE SET NULL', (alterErr) => {
          if (alterErr && !alterErr.message.includes('duplicate column')) {
            console.log('Migration note: cloth_name_id column may already exist:', alterErr.message);
          }
        });
        // V23: 添加 product_name 字段，存储品名+专属名+尺寸的复合产品名
        db.run('ALTER TABLE customer_products ADD COLUMN product_name TEXT', (alterErr) => {
          if (alterErr && !alterErr.message.includes('duplicate column')) {
            console.log('Migration note: product_name column may already exist:', alterErr.message);
          }
        });
        // V24: 客户表添加 secondary_customer_id 字段
        db.run('ALTER TABLE customers ADD COLUMN secondary_customer_id TEXT', (alterErr) => {
          if (alterErr && !alterErr.message.includes('duplicate column')) {
            console.log('Migration note: secondary_customer_id column may already exist:', alterErr.message);
          }
        });
        // V24: cloth_names 添加 spec/size/image 字段（合并 cloth_specs）
        db.run('ALTER TABLE cloth_names ADD COLUMN spec TEXT DEFAULT \'\'', (alterErr) => {
          if (alterErr && !alterErr.message.includes('duplicate column')) {
            console.log('Migration note: cloth_names.spec column may already exist:', alterErr.message);
          }
        });
        db.run('ALTER TABLE cloth_names ADD COLUMN size TEXT DEFAULT \'\'', (alterErr) => {
          if (alterErr && !alterErr.message.includes('duplicate column')) {
            console.log('Migration note: cloth_names.size column may already exist:', alterErr.message);
          }
        });
        db.run('ALTER TABLE cloth_names ADD COLUMN image TEXT', (alterErr) => {
          if (alterErr && !alterErr.message.includes('duplicate column')) {
            console.log('Migration note: cloth_names.image column may already exist:', alterErr.message);
          }
        });
        // V24: 将 cloth_specs 数据迁移到 cloth_names（每个规格创建一行）
        setTimeout(() => migrateClothSpecsToClothNames(), 300);
        // V25: customer_products 添加 name 和 size 字段（denormalized from cloth_names）
        db.run('ALTER TABLE customer_products ADD COLUMN name TEXT DEFAULT \'\'', (alterErr) => {
          if (alterErr && !alterErr.message.includes('duplicate column')) {
            console.log('Migration note: customer_products.name column may already exist:', alterErr.message);
          }
        });
        db.run('ALTER TABLE customer_products ADD COLUMN size TEXT DEFAULT \'\'', (alterErr) => {
          if (alterErr && !alterErr.message.includes('duplicate column')) {
            console.log('Migration note: customer_products.size column may already exist:', alterErr.message);
          }
        });
        // V25: 回填已有 customer_products 记录的 name 和 size
        setTimeout(() => backfillCustomerProductsNameSize(), 800);
        // V26: price_list_items 添加 customer_products_id 字段
        db.run('ALTER TABLE price_list_items ADD COLUMN customer_products_id INTEGER REFERENCES customer_products(id) ON DELETE SET NULL', (alterErr) => {
          if (alterErr && !alterErr.message.includes('duplicate column')) {
            console.log('Migration note: price_list_items.customer_products_id column may already exist:', alterErr.message);
          }
        });
        // V26: 回填已有 price_list_items 的 customer_products_id（按 price_lists.customer_id + category_id + spec_id 匹配）
        setTimeout(() => backfillPriceListItemsCustomerProductId(), 1200);
        // V27: 角色体系迁移（roles + role_grants 表，从 localStorage 迁移到数据库）
        setTimeout(() => migrateRolesTables(), 200);
        // V28: wash_order_items 价格快照字段 + order_settlements 表
        setTimeout(() => migrateOrderPricingTables(), 300);
      };

      if (!dbExists) {
        const initSql = fs.readFileSync(INIT_SQL_PATH, 'utf8');
        db.exec(initSql, (execErr) => {
          if (execErr) {
            reject(execErr);
            return;
          }
          console.log('Database initialized with sample data');
          resolve(db);
        });
      } else {
        console.log('Database connected');
        runMigrations();
        resolve(db);
      }
    });
  });
}

function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows);
    });
  });
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) {
        reject(err);
        return;
      }
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(row);
    });
  });
}

// V24 迁移：将 cloth_specs 数据迁移到 cloth_names
function migrateClothSpecsToClothNames() {
  // 检查 cloth_specs 是否存在
  db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='cloth_specs'", [], (err, table) => {
    if (err || !table) {
      console.log('V24 migration: cloth_specs table not found, skip migration');
      return;
    }
    db.all('SELECT id, name_id, category_id, name AS spec_name, size, image FROM cloth_specs', [], (sErr, oldSpecs) => {
      if (sErr || !oldSpecs || oldSpecs.length === 0) {
        console.log('V24 migration: no cloth_specs data to migrate');
        // 即使没有数据也删除表
        db.run('DROP TABLE IF EXISTS cloth_specs', () => {});
        return;
      }
      console.log(`V24 migration: migrating ${oldSpecs.length} cloth_specs rows...`);
      // 用大偏移生成新 id（避免与现有 cloth_names.id 冲突）
      const baseId = 100000;
      let pending = oldSpecs.length;
      oldSpecs.forEach((spec, idx) => {
        const newId = baseId + idx;
        // 插入新行到 cloth_names（保留原 name_id 用于关联）
        db.get('SELECT name FROM cloth_names WHERE id = ?', [spec.name_id], (nErr, origName) => {
          const clothName = origName ? origName.name : '';
          db.run(
            'INSERT OR IGNORE INTO cloth_names (id, name, spec, size, image, category_id, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [newId, clothName, spec.spec_name, spec.size || '', spec.image || null, spec.category_id, idx + 100],
            (insertErr) => {
              if (insertErr) {
                console.log(`V24 migration error at idx ${idx}:`, insertErr.message);
              } else {
                // 把 customer_products.spec_id 从旧 cloth_specs.id 改到新 cloth_names.id
                db.run('UPDATE customer_products SET spec_id = ? WHERE spec_id = ?', [newId, spec.id]);
                db.run('UPDATE base_price_lists SET spec_id = ? WHERE spec_id = ?', [newId, spec.id]);
                db.run('UPDATE price_list_items SET spec_id = ? WHERE spec_id = ?', [newId, spec.id]);
              }
              pending--;
              if (pending === 0) {
                // 所有迁移完成后删除 cloth_specs 表
                setTimeout(() => {
                  db.run('DROP TABLE IF EXISTS cloth_specs', (dropErr) => {
                    if (dropErr) console.log('V24 migration: drop cloth_specs failed:', dropErr.message);
                    else console.log('V24 migration: cloth_specs table dropped');
                  });
                }, 200);
              }
            }
          );
        });
      });
    });
  });
}

// V25 回填：从 cloth_names 填充 customer_products.name 和 size
function backfillCustomerProductsNameSize() {
  db.all('SELECT cp.id, cp.cloth_name_id, cp.spec_id FROM customer_products cp', [], (err, rows) => {
    if (err || !rows) return;
    rows.forEach(row => {
      const id = row.cloth_name_id || row.spec_id;
      if (!id) return;
      db.get('SELECT name, size FROM cloth_names WHERE id = ?', [id], (e, cn) => {
        if (cn) {
          db.run('UPDATE customer_products SET name = ?, size = ? WHERE id = ? AND (name IS NULL OR name = "")', [cn.name || '', cn.size || '', row.id]);
        }
      });
    });
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
    db.run(`ALTER TABLE wash_order_items ADD COLUMN ${def}`, (err) => {
      if (err && !err.message.includes('duplicate column')) {
        console.log(`V28 migration: add ${colName} note:`, err.message);
      }
    });
  });
  db.run(`CREATE TABLE IF NOT EXISTS order_settlements (
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
  )`, (err) => {
    if (err && !err.message.includes('duplicate')) {
      console.log('V28 migration: create order_settlements note:', err.message);
      return;
    }
    db.run('CREATE INDEX IF NOT EXISTS idx_order_settlements_order ON order_settlements(order_id)', () => {});
    db.run('CREATE INDEX IF NOT EXISTS idx_order_settlements_status ON order_settlements(status)', () => {});
  });
}

// V27 迁移：创建 roles / role_grants 表并种子内置角色（兼容已有数据库）
function migrateRolesTables() {
  db.run(`CREATE TABLE IF NOT EXISTS roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role_key TEXT UNIQUE NOT NULL,
    label TEXT NOT NULL,
    user_type TEXT NOT NULL DEFAULT 'company',
    builtin INTEGER DEFAULT 0,
    absolute INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (tErr) => {
    if (tErr && !tErr.message.includes('duplicate')) {
      console.log('V27 migration: create roles table note:', tErr.message);
      return;
    }
    // 种子内置超级管理员 + 预置用户角色（与种子用户 role 字段对应）
    const seedRoles = [
      ['superadmin', '超级管理员', 'company', 1, 1],
      ['admin', '系统管理员', 'company', 0, 0],
      ['statistician', '统计员', 'company', 0, 0],
      ['operator', '操作员', 'company', 0, 0]
    ];
    seedRoles.forEach(([key, label, type, builtin, absolute]) => {
      db.run(
        'INSERT OR IGNORE INTO roles (role_key, label, user_type, builtin, absolute) VALUES (?, ?, ?, ?, ?)',
        [key, label, type, builtin, absolute]
      );
    });
  });
  db.run(`CREATE TABLE IF NOT EXISTS role_grants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role_key TEXT NOT NULL,
    user_type TEXT NOT NULL DEFAULT 'company',
    path TEXT NOT NULL,
    UNIQUE(role_key, path)
  )`, (gErr) => {
    if (gErr && !gErr.message.includes('duplicate')) {
      console.log('V27 migration: create role_grants table note:', gErr.message);
      return;
    }
    db.run('CREATE INDEX IF NOT EXISTS idx_role_grants_key ON role_grants(role_key)', () => {});
  });
}

// V26 回填：根据 price_lists.customer_id + cloth_categories 名称 + item.spec_id 匹配 customer_products.id
function backfillPriceListItemsCustomerProductId() {
  db.all(`
    SELECT pli.id, pl.customer_id, cc.name AS category_name, pli.spec_id
    FROM price_list_items pli
    JOIN price_lists pl ON pli.price_list_id = pl.id
    LEFT JOIN cloth_categories cc ON pli.category_id = cc.id
    WHERE pli.customer_products_id IS NULL
  `, [], (err, items) => {
    if (err || !items) return;
    items.forEach(item => {
      db.get(
        'SELECT id FROM customer_products WHERE customer_id = ? AND category_name = ? AND spec_id = ? LIMIT 1',
        [item.customer_id, item.category_name || '', item.spec_id],
        (e, cp) => {
          if (cp && cp.id) {
            db.run('UPDATE price_list_items SET customer_products_id = ? WHERE id = ?', [cp.id, item.id]);
          }
        }
      );
    });
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