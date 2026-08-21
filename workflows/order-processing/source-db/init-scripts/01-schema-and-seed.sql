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
-- Story: "Ada's Beans Cafe" — a specialty coffee roaster shop.
-- Every customer below is a (deceased or fictionalized) computing pioneer
-- who is obviously NOT a real customer of a real coffee company — this is
-- demo/fixture data only. See ../SEED-REGISTRY.md for the full row->SE map.
-- ============================================================

-- ============================================================
-- Seed Data: Customers (13 records)
-- IDs 1-13 assigned; 14-19 RESERVED for future SEs; 99999 = not-found sentinel
-- 10-13 added Phase 3b (SE-07/08/09 new evals, see SEED-REGISTRY.md)
-- ============================================================
INSERT INTO ecommerce.customers (customer_id, first_name, last_name, email, phone, address, created_at) VALUES
(1, 'Ada',      'Lovelace',   'ada@adasbeanscafe.example',      '(415) 555-0101', '1 Analytical Engine Way, San Francisco, CA 94102', '2025-01-15 09:30:00'),
(2, 'Grace',    'Hopper',     'grace.hopper@example.com',       '(312) 555-0102', '1 Compiler Court, Chicago, IL 60610',               '2025-02-20 14:15:00'),
(3, 'Alan',     'Turing',     'alan.turing@example.com',        '(206) 555-0103', '1 Bletchley Row, Seattle, WA 98101',                '2025-03-08 11:45:00'),
(4, 'Margaret', 'Hamilton',   'margaret.hamilton@example.com',  NULL,             '1 Apollo Guidance Ave, Atlanta, GA 30305',          '2025-04-12 16:20:00'),
(5, 'Edsger',   'Dijkstra',   'edsger.dijkstra@example.com',    '(512) 555-0105', NULL,                                                '2025-05-01 10:00:00'),
(6, 'Donald',   'Knuth',      'donald.knuth@example.com',       '(650) 555-0106', '1 TeX Terrace, Palo Alto, CA 94301',                '2025-05-10 08:15:00'),
(7, 'Barbara',  'Liskov',     'barbara.liskov@example.com',     '(617) 555-0107', '1 Substitution Street, Cambridge, MA 02139',        '2025-05-18 13:40:00'),
(8, 'Radia',    'Perlman',    'radia.perlman@example.com',      '(781) 555-0108', '1 Spanning Tree Blvd, Burlington, MA 01803',        '2025-05-22 09:05:00'),
(9, 'Linus',    'Torvalds',   'linus.torvalds@example.com',     NULL,             '1 Kernel Circle, Portland, OR 97201',                '2025-05-30 17:50:00'),
(10, 'Katherine', 'Johnson',  'katherine.johnson@example.com',  '(757) 555-0110', '1 Trajectory Trail, Hampton, VA 23666',             '2025-08-01 09:00:00'),
(11, 'Hedy',    'Lamarr',     'hedy.lamarr@example.com',        '(310) 555-0111', '1 Frequency Hop Lane, Los Angeles, CA 90028',       '2025-08-04 10:30:00'),
(12, 'Dorothy', 'Vaughan',    'dorothy.vaughan@example.com',    '(757) 555-0112', '1 Fortran Fields, Hampton, VA 23666',               '2025-08-07 08:45:00'),
(13, 'Mary',    'Jackson',    'mary.jackson@example.com',       '(757) 555-0113', '1 Wind Tunnel Way, Hampton, VA 23666',              '2025-08-10 11:15:00');

-- ============================================================
-- Seed Data: Products (10 records) — the Ada's Beans Cafe menu
-- IDs 1-10 assigned; 11-19 RESERVED for future SEs; 99999 = not-found sentinel
-- ============================================================
INSERT INTO ecommerce.products (product_id, name, sku, price, category, description, in_stock) VALUES
(1,  'Midnight Roast 1kg',                    'ABC-MIDNIGHT-1KG',  21.50, 'Coffee / Whole Bean',   'Our darkest roast — bold, smoky, and built for polar-vortex mornings',        TRUE),
(2,  'Sunrise Blend 250g',                    'ABC-SUNRISE-250G',   9.50, 'Coffee / Whole Bean',   'A bright, easygoing breakfast blend of Central American beans',               TRUE),
(3,  'Ada''s House Espresso 500g',            'ABC-HOUSE-ESP-500G',18.00, 'Coffee / Espresso',     'The house pull — balanced, syrupy, unmistakably Ada''s',                      TRUE),
(4,  'Ethiopia Yirgacheffe Single-Origin 250g','ABC-YIRG-250G',     16.50, 'Coffee / Single-Origin','Floral and citrus-forward, washed process',                                    TRUE),
(5,  'Cascade Cold Brew Concentrate 1L',      'ABC-COLDBREW-1L',   14.00, 'Coffee / Cold Brew',    'Steeped 18 hours, dilute 1:1 over ice',                                        TRUE),
(6,  'Oat Milk Foamer Pitcher',               'ABC-FOAMER-OAT',    12.00, 'Merch / Brew Gear',     '600ml stainless pitcher, laser-etched with the Ada''s Beans logo',            TRUE),
(7,  'Pour-Over Dripper Set',                 'ABC-POUROVER-SET',  29.00, 'Merch / Brew Gear',     'Ceramic dripper + 40 filters + a stubbornly optimistic recipe card',          TRUE),
(8,  'Decaf Colombia Supremo 500g',           'ABC-DECAF-500G',    17.50, 'Coffee / Decaf',        'Swiss Water process, all the flavor, none of the 2am staring at the ceiling', FALSE),
(9,  'Barista Steel Tamper 58mm',             'ABC-TAMPER-58MM',   24.00, 'Merch / Brew Gear',     'Stainless 58mm tamper, flat base, weighted handle',                           TRUE),
(10, 'Ada''s Beans Subscription Box',         'ABC-SUBBOX-MO',     39.00, 'Bundle / Subscription', 'One bag a month, roaster''s choice, cancel anytime (you won''t)',             TRUE);

-- ============================================================
-- Seed Data: Orders (13 records)
-- IDs 1-13 assigned; 14-19 RESERVED for future SEs; 99999 = not-found sentinel
--   1 = SE-01 happy-path (Ada)              6 = SE-03 fan-out (Donald Knuth, 6 items)
--   2,3,4,5,9 = general story fill           7 = SE-04 partial-payment-failure (Barbara, no payment row)
--                                             8 = SE-05 quick-order variant (Radia)
--  10 = SE-07 quick-order-variant (Katherine)  12 = SE-09 required-cascade-failed (Dorothy, quick-order)
--  11 = SE-08 request-deduplication (Hedy)      13 = SE-09 optional-cascade-failed (Mary, default, 2 items)
-- Order totals equal the sum of their order_items below (orders 8, 10, 11, 12 are
-- quick-order — no order_items/payments/shipments rows, per the variant's DAG).
-- ============================================================
INSERT INTO ecommerce.orders (order_id, customer_id, order_date, status, total_amount, shipping_address) VALUES
(1, 1, '2025-06-01 10:23:00', 'delivered', 39.50,  '1 Analytical Engine Way, San Francisco, CA 94102'),
(2, 2, '2025-06-05 14:45:00', 'delivered', 33.00,  '1 Compiler Court, Chicago, IL 60610'),
(3, 3, '2025-06-12 09:10:00', 'shipped',   40.50,  '1 Bletchley Row, Seattle, WA 98101'),
(4, 4, '2025-06-18 16:30:00', 'confirmed', 39.00,  '1 Apollo Guidance Ave, Atlanta, GA 30305'),
(5, 5, '2025-06-25 11:55:00', 'pending',   17.50,  '1 TeX Terrace, Palo Alto, CA 94301'),
(6, 6, '2025-07-02 08:40:00', 'shipped',   163.50, '1 TeX Terrace, Palo Alto, CA 94301'),
(7, 7, '2025-07-08 13:20:00', 'shipped',   35.50,  '1 Substitution Street, Cambridge, MA 02139'),
(8, 8, '2025-07-10 17:05:00', 'confirmed', 45.00,  '1 Spanning Tree Blvd, Burlington, MA 01803'),
(9, 9, '2025-07-12 12:00:00', 'pending',   24.00,  '1 Kernel Circle, Portland, OR 97201'),
(10, 10, '2025-08-01 09:15:00', 'confirmed', 28.00, '1 Trajectory Trail, Hampton, VA 23666'),
(11, 11, '2025-08-04 11:00:00', 'confirmed', 32.00, '1 Frequency Hop Lane, Los Angeles, CA 90028'),
(12, 12, '2025-08-07 09:10:00', 'confirmed', 21.50, '1 Fortran Fields, Hampton, VA 23666'),
(13, 13, '2025-08-10 11:30:00', 'confirmed', 46.00, '1 Wind Tunnel Way, Hampton, VA 23666');

-- ============================================================
-- Seed Data: Order Items (19 records)
-- Orders 8, 10, 11, 12 (quick-order variant) intentionally have NO line items.
-- ============================================================
INSERT INTO ecommerce.order_items (order_item_id, order_id, product_id, quantity, unit_price, subtotal) VALUES
-- Order 1 (Ada, SE-01 happy-path): 21.50 + 18.00 = 39.50
(1,  1, 1, 1, 21.50, 21.50),
(2,  1, 3, 1, 18.00, 18.00),
-- Order 2 (Grace, general): 19.00 + 14.00 = 33.00
(3,  2, 2, 2,  9.50, 19.00),
(4,  2, 5, 1, 14.00, 14.00),
-- Order 3 (Alan, general): 16.50 + 24.00 = 40.50
(5,  3, 4, 1, 16.50, 16.50),
(6,  3, 9, 1, 24.00, 24.00),
-- Order 4 (Margaret, general): 39.00
(7,  4, 10, 1, 39.00, 39.00),
-- Order 5 (Edsger, general, pending): 17.50
(8,  5, 8, 1, 17.50, 17.50),
-- Order 6 (Donald Knuth, SE-03 fan-out — 6 items): 43.00+28.50+18.00+33.00+12.00+29.00 = 163.50
(9,  6, 1, 2, 21.50, 43.00),
(10, 6, 2, 3,  9.50, 28.50),
(11, 6, 3, 1, 18.00, 18.00),
(12, 6, 4, 2, 16.50, 33.00),
(13, 6, 6, 1, 12.00, 12.00),
(14, 6, 7, 1, 29.00, 29.00),
-- Order 7 (Barbara Liskov, SE-04 partial-payment-failure): 21.50 + 14.00 = 35.50
(15, 7, 1, 1, 21.50, 21.50),
(16, 7, 5, 1, 14.00, 14.00),
-- Order 9 (Linus, general filler, pending): 24.00
(17, 9, 9, 1, 24.00, 24.00),
-- Order 13 (Mary Jackson, SE-09 optional-cascade-failed): 21.50 + 24.50... use existing product prices: 22.00 + 24.00 = 46.00
(18, 13, 1, 1, 22.00, 22.00),
(19, 13, 9, 1, 24.00, 24.00);

-- ============================================================
-- Seed Data: Payments (6 records)
-- Order 7 (Barbara Liskov / SE-04) has NO payment row on purpose — the
-- beans left the roastery before the card finished processing. ValidatePayment
-- filters payments by order_id, so payload.paymentId=7 legitimately finds zero
-- rows, driving the PARTIAL_SUCCESS outcome.
-- Orders 5, 8, 9, 10, 11, 12 have no payment yet either (pending / quick-order variant).
-- ============================================================
INSERT INTO ecommerce.payments (payment_id, order_id, payment_method, amount, payment_date, status, transaction_ref) VALUES
(1, 1, 'credit_card',   39.50,  '2025-06-01 10:25:00', 'completed', 'TXN-CC-20250601-0001'),
(2, 2, 'paypal',        33.00,  '2025-06-05 14:48:00', 'completed', 'TXN-PP-20250605-0002'),
(3, 3, 'credit_card',   40.50,  '2025-06-12 09:12:00', 'completed', 'TXN-CC-20250612-0003'),
(4, 4, 'bank_transfer', 39.00,  '2025-06-18 16:35:00', 'completed', 'TXN-BT-20250618-0004'),
(5, 6, 'credit_card',   163.50, '2025-07-02 08:42:00', 'completed', 'TXN-CC-20250702-0005'),
(6, 13, 'credit_card',  46.00,  '2025-08-10 11:35:00', 'completed', 'TXN-CC-20250810-0006');

-- ============================================================
-- Seed Data: Shipments (6 records)
-- Order 7's shipment exists even though its payment doesn't — the roastery
-- shipped anyway (this is exactly the story PARTIAL_SUCCESS is telling).
-- ============================================================
INSERT INTO ecommerce.shipments (shipment_id, order_id, carrier, tracking_number, shipped_date, estimated_delivery, status) VALUES
(1, 1, 'ups',   '1Z999AA10123456784',  '2025-06-02 08:00:00', '2025-06-05 18:00:00', 'delivered'),
(2, 2, 'fedex', '794644790301',        '2025-06-06 10:30:00', '2025-06-09 18:00:00', 'delivered'),
(3, 3, 'usps',  '9400111899223100001', '2025-06-13 07:45:00', '2025-06-17 18:00:00', 'shipped'),
(4, 6, 'fedex', '794644790302',        '2025-07-03 09:15:00', '2025-07-06 18:00:00', 'shipped'),
(6, 13, 'ups',  '1Z999AA10123456799',  '2025-08-11 08:00:00', '2025-08-14 18:00:00', 'shipped'),
(5, 7, 'dhl',   '3S9999999999',        '2025-07-09 07:30:00', '2025-07-12 18:00:00', 'shipped');
