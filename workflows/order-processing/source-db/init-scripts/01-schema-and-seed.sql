-- ============================================================
-- Order Processing Source Database
-- Schema creation, table definitions, and seed data
-- ============================================================

-- Create the ecommerce schema
CREATE SCHEMA IF NOT EXISTS ecommerce;

-- ============================================================
-- Table: ecommerce.customers
-- ============================================================
CREATE TABLE ecommerce.customers (
    customer_id    INTEGER      PRIMARY KEY,
    first_name     VARCHAR(50)  NOT NULL,
    last_name      VARCHAR(50)  NOT NULL,
    email          VARCHAR(100) NOT NULL,
    phone          VARCHAR(20),
    address        TEXT,
    created_at     TIMESTAMP    NOT NULL
);

-- ============================================================
-- Table: ecommerce.products
-- ============================================================
CREATE TABLE ecommerce.products (
    product_id     INTEGER       PRIMARY KEY,
    name           VARCHAR(100)  NOT NULL,
    sku            VARCHAR(50)   NOT NULL,
    price          DECIMAL(10,2) NOT NULL,
    category       VARCHAR(50),
    description    TEXT,
    in_stock       BOOLEAN       NOT NULL DEFAULT TRUE
);

-- ============================================================
-- Table: ecommerce.orders
-- ============================================================
CREATE TABLE ecommerce.orders (
    order_id         INTEGER       PRIMARY KEY,
    customer_id      INTEGER       NOT NULL REFERENCES ecommerce.customers(customer_id),
    order_date       TIMESTAMP     NOT NULL,
    status           VARCHAR(20)   NOT NULL,
    total_amount     DECIMAL(10,2) NOT NULL,
    shipping_address TEXT
);

-- ============================================================
-- Table: ecommerce.order_items
-- ============================================================
CREATE TABLE ecommerce.order_items (
    order_item_id  INTEGER       PRIMARY KEY,
    order_id       INTEGER       NOT NULL REFERENCES ecommerce.orders(order_id),
    product_id     INTEGER       NOT NULL REFERENCES ecommerce.products(product_id),
    quantity       INTEGER       NOT NULL,
    unit_price     DECIMAL(10,2) NOT NULL,
    subtotal       DECIMAL(10,2) NOT NULL
);

-- ============================================================
-- Table: ecommerce.payments
-- ============================================================
CREATE TABLE ecommerce.payments (
    payment_id      INTEGER       PRIMARY KEY,
    order_id        INTEGER       NOT NULL REFERENCES ecommerce.orders(order_id),
    payment_method  VARCHAR(50)   NOT NULL,
    amount          DECIMAL(10,2) NOT NULL,
    payment_date    TIMESTAMP     NOT NULL,
    status          VARCHAR(20)   NOT NULL,
    transaction_ref VARCHAR(100)
);

-- ============================================================
-- Table: ecommerce.shipments
-- ============================================================
CREATE TABLE ecommerce.shipments (
    shipment_id        INTEGER     PRIMARY KEY,
    order_id           INTEGER     NOT NULL REFERENCES ecommerce.orders(order_id),
    carrier            VARCHAR(50) NOT NULL,
    tracking_number    VARCHAR(100),
    shipped_date       TIMESTAMP,
    estimated_delivery TIMESTAMP,
    status             VARCHAR(20) NOT NULL
);

-- ============================================================
-- Seed Data: Customers (5 records)
-- ============================================================
INSERT INTO ecommerce.customers (customer_id, first_name, last_name, email, phone, address, created_at) VALUES
(1, 'Sarah',   'Mitchell',  'sarah.mitchell@email.com',   '(415) 555-0142', '742 Evergreen Terrace, San Francisco, CA 94102',  '2025-01-15 09:30:00'),
(2, 'James',   'Rodriguez', 'james.rodriguez@email.com',  '(312) 555-0198', '1200 Lake Shore Dr, Apt 4B, Chicago, IL 60610',   '2025-02-20 14:15:00'),
(3, 'Emily',   'Chen',      'emily.chen@email.com',       '(206) 555-0173', '889 Pine Street, Suite 12, Seattle, WA 98101',    '2025-03-08 11:45:00'),
(4, 'Michael', 'Thompson',  'michael.thompson@email.com', NULL,             '2501 Peachtree Rd NE, Atlanta, GA 30305',         '2025-04-12 16:20:00'),
(5, 'Olivia',  'Patel',     'olivia.patel@email.com',     '(512) 555-0156', NULL,                                              '2025-05-01 10:00:00');

-- ============================================================
-- Seed Data: Products (10 records)
-- ============================================================
INSERT INTO ecommerce.products (product_id, name, sku, price, category, description, in_stock) VALUES
(1,  'Sony WH-1000XM5 Wireless Headphones',    'SONY-WH1000XM5',   349.99, 'Electronics',     'Industry-leading noise canceling overhead headphones with Auto NC Optimizer',   TRUE),
(2,  'Apple iPad Air 11-inch (M2)',             'APPLE-IPADAIR-M2',  599.00, 'Electronics',     '11-inch Liquid Retina display, M2 chip, 128GB storage',                         TRUE),
(3,  'Patagonia Better Sweater Fleece Jacket',  'PAT-BTSW-FLC-M',   139.00, 'Clothing',        'Fair Trade Certified sewn, 100% recycled polyester fleece',                      TRUE),
(4,  'Yeti Rambler 20 oz Tumbler',              'YETI-RAM-20OZ',      35.00, 'Kitchen',         'Double-wall vacuum insulated, 18/8 stainless steel tumbler with MagSlider Lid', TRUE),
(5,  'Moleskine Classic Notebook Large',         'MLSK-CLSC-LG',      19.95, 'Office Supplies', 'Large ruled notebook, hard cover, 240 pages, 5 x 8.25 inches',                 TRUE),
(6,  'Nike Air Max 270 Running Shoes',           'NIKE-AM270-BLK',   159.99, 'Footwear',        'Max Air unit delivers unrivaled all-day comfort, black colorway',               TRUE),
(7,  'Bose SoundLink Flex Bluetooth Speaker',   'BOSE-SLKFLEX',     149.00, 'Electronics',     'Portable waterproof Bluetooth speaker with deep, clear sound',                  TRUE),
(8,  'Le Creuset Enameled Cast Iron Dutch Oven', 'LECR-DO-5QT',     379.95, 'Kitchen',         '5.5 qt round Dutch oven in Flame, superior heat distribution',                  FALSE),
(9,  'Osprey Daylite Plus Backpack',             'OSP-DAYLTP-BLU',    74.95, 'Outdoor',         '20L daypack with laptop sleeve, panel-loading design, blue colorway',           TRUE),
(10, 'Kindle Paperwhite Signature Edition',      'AMZN-KPW-SIG',    189.99, 'Electronics',     '6.8-inch display, wireless charging, auto-adjusting front light, 32GB',         TRUE);

-- ============================================================
-- Seed Data: Orders (8 records)
-- Order totals are calculated from order_items below
-- ============================================================
INSERT INTO ecommerce.orders (order_id, customer_id, order_date, status, total_amount, shipping_address) VALUES
(1, 1, '2025-06-01 10:23:00', 'delivered',  404.94, '742 Evergreen Terrace, San Francisco, CA 94102'),
(2, 2, '2025-06-05 14:45:00', 'delivered',  827.95, '1200 Lake Shore Dr, Apt 4B, Chicago, IL 60610'),
(3, 1, '2025-06-12 09:10:00', 'shipped',    149.85, '742 Evergreen Terrace, San Francisco, CA 94102'),
(4, 3, '2025-06-18 16:30:00', 'shipped',    453.79, '889 Pine Street, Suite 12, Seattle, WA 98101'),
(5, 4, '2025-06-25 11:55:00', 'confirmed',  569.84, '2501 Peachtree Rd NE, Atlanta, GA 30305'),
(6, 5, '2025-07-02 08:40:00', 'confirmed',  837.95, '318 Congress Ave, Austin, TX 78701'),
(7, 2, '2025-07-08 13:20:00', 'pending',    159.99, '1200 Lake Shore Dr, Apt 4B, Chicago, IL 60610'),
(8, 3, '2025-07-10 17:05:00', 'pending',    569.94, '889 Pine Street, Suite 12, Seattle, WA 98101');

-- ============================================================
-- Seed Data: Order Items (25 records)
-- ============================================================
INSERT INTO ecommerce.order_items (order_item_id, order_id, product_id, quantity, unit_price, subtotal) VALUES
-- Order 1 (customer 1, delivered): 349.99 + 35.00 + 19.95 = 404.94
(1,  1, 1,  1, 349.99, 349.99),
(2,  1, 4,  1,  35.00,  35.00),
(3,  1, 5,  1,  19.95,  19.95),
-- Order 2 (customer 2, delivered): 599.00 + 139.00 + 70.00 + 19.95 = 827.95
(4,  2, 2,  1, 599.00, 599.00),
(5,  2, 3,  1, 139.00, 139.00),
(6,  2, 4,  2,  35.00,  70.00),
(7,  2, 5,  1,  19.95,  19.95),
-- Order 3 (customer 1, shipped): 39.90 + 74.95 + 35.00 = 149.85
(8,  3, 5,  2,  19.95,  39.90),
(9,  3, 9,  1,  74.95,  74.95),
(10, 3, 4,  1,  35.00,  35.00),
-- Order 4 (customer 3, shipped): 149.00 + 79.80 + 35.00 + 189.99 = 453.79
(11, 4, 7,  1, 149.00, 149.00),
(12, 4, 5,  4,  19.95,  79.80),
(13, 4, 4,  1,  35.00,  35.00),
(14, 4, 10, 1, 189.99, 189.99),
-- Order 5 (customer 4, confirmed): 349.99 + 105.00 + 74.95 + 39.90 = 569.84
(15, 5, 1,  1, 349.99, 349.99),
(16, 5, 4,  3,  35.00, 105.00),
(17, 5, 9,  1,  74.95,  74.95),
(18, 5, 5,  2,  19.95,  39.90),
-- Order 6 (customer 5, confirmed): 599.00 + 19.95 + 70.00 + 149.00 = 837.95
(19, 6, 2,  1, 599.00, 599.00),
(20, 6, 5,  1,  19.95,  19.95),
(21, 6, 4,  2,  35.00,  70.00),
(22, 6, 7,  1, 149.00, 149.00),
-- Order 7 (customer 2, pending): 159.99 = 159.99
(23, 7, 6,  1, 159.99, 159.99),
-- Order 8 (customer 3, pending): 379.95 + 189.99 = 569.94
(24, 8, 8,  1, 379.95, 379.95),
(25, 8, 10, 1, 189.99, 189.99);

-- ============================================================
-- Seed Data: Payments (8 records, one per order)
-- ============================================================
INSERT INTO ecommerce.payments (payment_id, order_id, payment_method, amount, payment_date, status, transaction_ref) VALUES
(1, 1, 'credit_card',   404.94, '2025-06-01 10:25:00', 'completed', 'TXN-CC-20250601-0001'),
(2, 2, 'paypal',        827.95, '2025-06-05 14:48:00', 'completed', 'TXN-PP-20250605-0002'),
(3, 3, 'credit_card',   149.85, '2025-06-12 09:12:00', 'completed', 'TXN-CC-20250612-0003'),
(4, 4, 'bank_transfer', 453.79, '2025-06-18 16:35:00', 'completed', 'TXN-BT-20250618-0004'),
(5, 5, 'credit_card',   569.84, '2025-06-25 11:58:00', 'completed', 'TXN-CC-20250625-0005'),
(6, 6, 'paypal',        837.95, '2025-07-02 08:42:00', 'completed', 'TXN-PP-20250702-0006'),
(7, 7, 'credit_card',   159.99, '2025-07-08 13:22:00', 'pending',   NULL),
(8, 8, 'bank_transfer', 569.94, '2025-07-10 17:08:00', 'pending',   NULL);

-- ============================================================
-- Seed Data: Shipments (6 records, not all orders shipped)
-- Orders 7 and 8 (pending) have no shipments yet
-- ============================================================
INSERT INTO ecommerce.shipments (shipment_id, order_id, carrier, tracking_number, shipped_date, estimated_delivery, status) VALUES
(1, 1, 'ups',   '1Z999AA10123456784',  '2025-06-02 08:00:00', '2025-06-05 18:00:00', 'delivered'),
(2, 2, 'fedex', '794644790301',        '2025-06-06 10:30:00', '2025-06-09 18:00:00', 'delivered'),
(3, 3, 'usps',  '9400111899223100001', '2025-06-13 07:45:00', '2025-06-17 18:00:00', 'shipped'),
(4, 4, 'ups',   '1Z999AA10123456785',  '2025-06-19 09:15:00', '2025-06-23 18:00:00', 'in_transit'),
(5, 5, 'dhl',   NULL,                   NULL,                   NULL,                   'preparing'),
(6, 6, 'fedex', NULL,                   NULL,                   NULL,                   'preparing');
