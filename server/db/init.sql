PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL,
    name TEXT,
    wechat BOOLEAN DEFAULT 0,
    fingerprint BOOLEAN DEFAULT 0,
    face_recognition BOOLEAN DEFAULT 0,
    require_confirm BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_name TEXT NOT NULL,
    short_name TEXT NOT NULL,
    secondary_customer_id TEXT,
    company_type TEXT,
    registered_capital TEXT,
    business_license TEXT UNIQUE,
    tax_number TEXT UNIQUE,
    legal_person TEXT,
    address TEXT,
    phone TEXT,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customer_bank_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    bank_name TEXT NOT NULL,
    account_number TEXT NOT NULL,
    account_name TEXT NOT NULL,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS customer_admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    position TEXT,
    phone TEXT,
    email TEXT,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS cloth_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cloth_names (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    spec TEXT DEFAULT '',
    size TEXT DEFAULT '',
    image TEXT,
    category_id INTEGER NOT NULL,
    note TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES cloth_categories(id) ON DELETE CASCADE
);
-- V24: cloth_specs 表已合并到 cloth_names（每行=品名+规格+尺寸），不再单独建表

-- 客户清单表 (customer_id + secondary_customer 双主键关联客户表)
CREATE TABLE IF NOT EXISTS customer_products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER,
    temp_customer TEXT,
    secondary_customer TEXT DEFAULT '',
    category_name TEXT DEFAULT '',          -- 分类名
    spec_id INTEGER,                        -- 规格ID → cloth_names.id
    material TEXT,
    color TEXT,
    unit_price REAL DEFAULT 0,
    alias TEXT,
    image TEXT,
    is_default BOOLEAN DEFAULT 0,
    quantity INTEGER DEFAULT 0,
    note TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    cloth_name_id INTEGER,                  -- 品名ID → cloth_names.id
    product_name TEXT,                      -- 产品名（自动生成=alias+name+spec+size，可编辑）
    name TEXT DEFAULT '',                   -- 品名（denormalized from cloth_names.name）
    size TEXT DEFAULT '',                   -- 尺寸（denormalized from cloth_names.size）
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
    FOREIGN KEY (cloth_name_id) REFERENCES cloth_names(id) ON DELETE SET NULL,
    FOREIGN KEY (spec_id) REFERENCES cloth_names(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS base_price_lists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    spec_id INTEGER NOT NULL,              -- V24: 现指向 cloth_names.id
    base_price REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (spec_id) REFERENCES cloth_names(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS price_lists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    start_time DATE NOT NULL,
    end_time DATE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS price_list_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    price_list_id INTEGER NOT NULL,
    category_id INTEGER NOT NULL,
    spec_id INTEGER,                         -- V27: 允许 NULL，实现"同品不同价"（NULL 表示品类通用价）
    wash_price REAL NOT NULL,
    customer_products_id INTEGER,            -- V26: 关联客户清单表 id（可选，用于快速定位）
    FOREIGN KEY (price_list_id) REFERENCES price_lists(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES cloth_categories(id) ON DELETE CASCADE,
    FOREIGN KEY (spec_id) REFERENCES cloth_names(id) ON DELETE SET NULL,
    FOREIGN KEY (customer_products_id) REFERENCES customer_products(id) ON DELETE SET NULL,
    UNIQUE (price_list_id, category_id, spec_id)  -- V27: 防止同一规格配置多条冲突价格
);

CREATE TABLE IF NOT EXISTS daily_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    date DATE NOT NULL,
    note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES customer_products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workflow_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    step_order INTEGER NOT NULL,
    step_name TEXT NOT NULL,
    has_sub BOOLEAN DEFAULT 0,
    sub_steps TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customer_workflows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    start_time DATE NOT NULL,
    end_time DATE,
    enabled_steps TEXT,
    step_details TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS wash_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_no TEXT UNIQUE NOT NULL,
    customer_id INTEGER NOT NULL,
    status TEXT DEFAULT 'forecast',
    forecast_user_id INTEGER,
    forecast_time DATETIME,
    forecast_confirmed BOOLEAN DEFAULT 0,
    forecast_confirmed_by INTEGER,
    forecast_confirmed_time DATETIME,
    collect_user_id INTEGER,
    collect_time DATETIME,
    collect_confirmed BOOLEAN DEFAULT 0,
    wash_user_id INTEGER,
    wash_time DATETIME,
    wash_confirmed BOOLEAN DEFAULT 0,
    handover_user_id INTEGER,
    handover_time DATETIME,
    handover_confirmed BOOLEAN DEFAULT 0,
    handover_confirmed_by INTEGER,
    handover_confirmed_time DATETIME,
    note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
    FOREIGN KEY (forecast_user_id) REFERENCES users(id),
    FOREIGN KEY (forecast_confirmed_by) REFERENCES users(id),
    FOREIGN KEY (collect_user_id) REFERENCES users(id),
    FOREIGN KEY (wash_user_id) REFERENCES users(id),
    FOREIGN KEY (handover_user_id) REFERENCES users(id),
    FOREIGN KEY (handover_confirmed_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS wash_order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    forecast_quantity INTEGER DEFAULT 0,
    collect_quantity INTEGER DEFAULT 0,
    completed_quantity INTEGER DEFAULT 0,
    remaining_quantity INTEGER DEFAULT 0,
    handover_quantity INTEGER DEFAULT 0,
    note TEXT,
    unit_price REAL DEFAULT 0,
    total_price REAL DEFAULT 0,
    billing_quantity INTEGER DEFAULT 0,
    price_source TEXT DEFAULT '',
    price_list_id INTEGER,
    calculated_at DATETIME,
    FOREIGN KEY (order_id) REFERENCES wash_orders(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES customer_products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS wash_completions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_item_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    completed_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_by INTEGER,
    note TEXT,
    FOREIGN KEY (order_item_id) REFERENCES wash_order_items(id) ON DELETE CASCADE,
    FOREIGN KEY (completed_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS wash_operations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    operation_type TEXT NOT NULL,
    operator_id INTEGER NOT NULL,
    operation_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    terminal_type TEXT DEFAULT 'web',
    bio_type TEXT,
    bio_result BOOLEAN DEFAULT 0,
    note TEXT,
    FOREIGN KEY (order_id) REFERENCES wash_orders(id) ON DELETE CASCADE,
    FOREIGN KEY (operator_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS order_changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    operation_type TEXT NOT NULL,
    operator_id INTEGER NOT NULL,
    operation_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    terminal_type TEXT DEFAULT 'web',
    bio_type TEXT,
    bio_result BOOLEAN DEFAULT 0,
    note TEXT,
    FOREIGN KEY (order_id) REFERENCES wash_orders(id) ON DELETE CASCADE,
    FOREIGN KEY (operator_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS holidays (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    holiday_name TEXT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- V28: 订单结算表（应收/实收/差异对账）
CREATE TABLE IF NOT EXISTS order_settlements (
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
);
CREATE INDEX IF NOT EXISTS idx_order_settlements_order ON order_settlements(order_id);
CREATE INDEX IF NOT EXISTS idx_order_settlements_status ON order_settlements(status);

CREATE TABLE IF NOT EXISTS custom_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    report_name TEXT NOT NULL,
    cycle TEXT NOT NULL,
    start_date DATE,
    row_header TEXT NOT NULL,
    column_header TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cloth_names_category ON cloth_names(category_id);
CREATE INDEX IF NOT EXISTS idx_cloth_names_sort ON cloth_names(sort_order);
-- V24: cloth_specs 已合并到 cloth_names，原 idx_cloth_specs_* 索引不再需要
CREATE INDEX IF NOT EXISTS idx_customer_products_customer ON customer_products(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_products_sort ON customer_products(sort_order);
CREATE INDEX IF NOT EXISTS idx_customer_products_dual_key ON customer_products(customer_id, secondary_customer);
CREATE INDEX IF NOT EXISTS idx_customer_products_cloth_name_id ON customer_products(cloth_name_id);
CREATE INDEX IF NOT EXISTS idx_daily_records_date ON daily_records(date);
CREATE INDEX IF NOT EXISTS idx_daily_records_customer ON daily_records(customer_id);
CREATE INDEX IF NOT EXISTS idx_daily_records_product ON daily_records(product_id);
CREATE INDEX IF NOT EXISTS idx_price_lists_customer ON price_lists(customer_id);
CREATE INDEX IF NOT EXISTS idx_price_lists_time ON price_lists(start_time, end_time);
-- V27: 价格查询优化索引（支持两级匹配：精确规格 -> 品类兜底）
CREATE INDEX IF NOT EXISTS idx_price_lookup ON price_list_items(price_list_id, category_id, spec_id);
CREATE INDEX IF NOT EXISTS idx_wash_orders_status ON wash_orders(status);
CREATE INDEX IF NOT EXISTS idx_wash_orders_customer ON wash_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_wash_orders_order_no ON wash_orders(order_no);
CREATE INDEX IF NOT EXISTS idx_wash_order_items_order ON wash_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_wash_completions_item ON wash_completions(order_item_id);
CREATE INDEX IF NOT EXISTS idx_wash_operations_order ON wash_operations(order_id);

-- V27: 角色定义表（从 localStorage 迁移到数据库，支持多浏览器/多用户共享）
CREATE TABLE IF NOT EXISTS roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role_key TEXT UNIQUE NOT NULL,
    label TEXT NOT NULL,
    user_type TEXT NOT NULL DEFAULT 'company',
    builtin INTEGER DEFAULT 0,
    absolute INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- V27: 角色权限授权表（角色 → 可访问的操作路径列表）
CREATE TABLE IF NOT EXISTS role_grants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role_key TEXT NOT NULL,
    user_type TEXT NOT NULL DEFAULT 'company',
    path TEXT NOT NULL,
    UNIQUE(role_key, path)
);
CREATE INDEX IF NOT EXISTS idx_role_grants_key ON role_grants(role_key);

-- 内置超级管理员 + 预置用户角色（与种子用户 role 字段对应，超管可修改/删除）
INSERT OR IGNORE INTO roles (role_key, label, user_type, builtin, absolute) VALUES
('superadmin', '超级管理员', 'company', 1, 1),
('admin', '系统管理员', 'company', 0, 0),
('statistician', '统计员', 'company', 0, 0),
('operator', '操作员', 'company', 0, 0);

INSERT OR IGNORE INTO users (id, username, password, role, name, wechat, fingerprint, face_recognition, require_confirm) VALUES
(1, 'admin', '1', 'admin', '系统管理员', 1, 1, 1, 1),
(2, 'stat', 'stat123', 'statistician', '统计员小张', 1, 0, 0, 1),
(3, 'oper', 'oper123', 'operator', '操作员小李', 0, 1, 1, 1),
(4, 'cust001', 'cust123', 'customer', '客户王先生', 0, 0, 0, 1),
(5, 'delivery', 'delivery123', 'operator', '配送员小刘', 0, 1, 1, 1);

INSERT OR IGNORE INTO customers (id, company_name, short_name, company_type, registered_capital, business_license, tax_number, legal_person, address, phone) VALUES
(1, '北京悦来大酒店有限公司', '悦来大酒店', '有限责任公司', '5000万人民币', '91110105MA00000000', '110105000000000', '张建国', '北京市朝阳区建国门外大街1号', '010-12345678'),
(2, '上海锦绣度假村股份有限公司', '锦绣度假村', '股份有限公司', '8000万人民币', '91310101MA11111111', '310101111111111', '王晓明', '上海市黄浦区外滩18号', '021-87654321');

INSERT OR IGNORE INTO customer_bank_accounts (id, customer_id, bank_name, account_number, account_name) VALUES
(1, 1, '中国工商银行北京分行', '6222020200000000000', '北京悦来大酒店有限公司'),
(2, 1, '中国建设银行北京分行', '6227000000000000001', '北京悦来大酒店有限公司'),
(3, 2, '中国建设银行上海分行', '6227000000000000000', '上海锦绣度假村股份有限公司');

INSERT OR IGNORE INTO customer_admins (id, customer_id, name, position, phone, email) VALUES
(1, 1, '李明', '采购经理', '13800138001', 'liming@yuelai.com'),
(2, 1, '王芳', '财务主管', '13800138002', 'wangfang@yuelai.com'),
(3, 2, '赵雪', '总经理', '13900139001', 'zhaoxue@jinxiu.com');

INSERT OR IGNORE INTO cloth_categories (id, name, note) VALUES
(1, '床上用品', '床单、被套、枕套等'),
(2, '洗浴用品', '毛巾、浴巾等');

INSERT OR IGNORE INTO cloth_names (id, name, spec, size, category_id, note, sort_order) VALUES
(1, '床单', '单人床', '1.2m×2.0m', 1, '客房床单', 0),
(2, '床单', '双人床', '1.5m×2.0m', 1, '客房床单', 1),
(3, '床单', '加大床', '1.8m×2.2m', 1, '客房床单', 2),
(4, '被套', '单人被套', '1.5m×2.1m', 1, '客房被套', 3),
(5, '被套', '双人被套', '2.0m×2.3m', 1, '客房被套', 4),
(6, '毛巾', '小毛巾', '30cm×30cm', 2, '客房毛巾', 5),
(7, '毛巾', '大毛巾', '70cm×140cm', 2, '客房毛巾', 6),
(8, '浴巾', '标准浴巾', '70cm×140cm', 2, '客房浴巾', 7),
(9, '枕套', '标准枕套', '50cm×70cm', 1, '客房枕套', 8);
-- V24: cloth_specs 已合并到 cloth_names，不再单独插入

INSERT OR IGNORE INTO customer_products (id, customer_id, category_name, name, spec_id, size, material, color, unit_price, alias, product_name, quantity, note, sort_order) VALUES
(1, 1, '客房布草', '床单', 1, '1.2m×2.0m', '纯棉', '白色', 50, '客房床单', '客房床单 床单 单人床 1.2m×2.0m', 100, '标准客房使用', 0),
(2, 1, '客房布草', '床单', 2, '1.5m×2.0m', '纯棉', '白色', 65, '套房床单', '套房床单 床单 双人床 1.5m×2.0m', 50, '套房使用', 1),
(3, 2, '客房布草', '被套', 5, '2.0m×2.3m', '磨毛', '米色', 110, 'VIP被套', 'VIP被套 被套 双人被套 2.0m×2.3m', 30, '供VIP房间使用', 0);

INSERT OR IGNORE INTO price_lists (id, customer_id, name, start_time, end_time) VALUES
(1, 1, '标准价目表', '2024-01-01', '2024-12-31'),
(2, 1, '旺季价目表', '2025-01-01', ''),
(3, 2, '基础价目表', '2024-06-01', '');

INSERT OR IGNORE INTO price_list_items (id, price_list_id, category_id, spec_id, wash_price, customer_products_id) VALUES
(1, 1, 1, 1, 50, 1),
(2, 1, 1, 2, 65, 2),
(3, 2, 1, 1, 55, 1),
(4, 2, 1, 2, 70, 2),
(5, 3, 1, 5, 110, 3);

INSERT OR IGNORE INTO daily_records (id, customer_id, product_id, quantity, date) VALUES
(1, 1, 1, 10, '2024-01-01'),
(2, 1, 2, 5, '2024-01-01'),
(3, 1, 1, 8, '2024-01-02'),
(4, 1, 2, 6, '2024-01-02'),
(5, 1, 1, 12, '2024-01-03'),
(6, 1, 2, 4, '2024-01-03'),
(7, 1, 1, 9, '2024-01-04'),
(8, 1, 2, 7, '2024-01-04'),
(9, 1, 1, 11, '2024-01-05'),
(10, 1, 2, 3, '2024-01-05'),
(11, 2, 3, 15, '2024-01-01'),
(12, 2, 3, 18, '2024-01-02'),
(13, 2, 3, 12, '2024-01-03'),
(14, 2, 3, 20, '2024-01-04'),
(15, 2, 3, 16, '2024-01-05');