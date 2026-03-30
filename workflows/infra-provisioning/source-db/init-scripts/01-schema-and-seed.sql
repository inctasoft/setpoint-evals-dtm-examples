-- ============================================================
-- Infra Provisioning Source Database
-- Schema creation, table definitions, and seed data
-- ============================================================

-- Create the dbo schema
CREATE SCHEMA IF NOT EXISTS dbo;

-- ============================================================
-- Table: dbo.environments
-- ============================================================
CREATE TABLE dbo.environments (
    environment_id  VARCHAR(50)  PRIMARY KEY,
    name            VARCHAR(100) NOT NULL,
    type            VARCHAR(20)  NOT NULL,
    region          VARCHAR(50)  NOT NULL,
    account_id      VARCHAR(50)  NOT NULL,
    status          VARCHAR(20)  NOT NULL,
    created_at      TIMESTAMP    NOT NULL
);

-- ============================================================
-- Table: dbo.networks
-- ============================================================
CREATE TABLE dbo.networks (
    network_id        VARCHAR(50)  PRIMARY KEY,
    environment_id    VARCHAR(50)  NOT NULL REFERENCES dbo.environments(environment_id),
    name              VARCHAR(100) NOT NULL,
    vpc_cidr          VARCHAR(20)  NOT NULL,
    subnet_cidr       VARCHAR(20)  NOT NULL,
    availability_zone VARCHAR(20)  NOT NULL,
    status            VARCHAR(20)  NOT NULL,
    created_at        TIMESTAMP    NOT NULL
);

-- ============================================================
-- Table: dbo.compute_instances
-- ============================================================
CREATE TABLE dbo.compute_instances (
    instance_id   VARCHAR(50)  PRIMARY KEY,
    network_id    VARCHAR(50)  NOT NULL REFERENCES dbo.networks(network_id),
    name          VARCHAR(100) NOT NULL,
    instance_type VARCHAR(20)  NOT NULL,
    ami_id        VARCHAR(50)  NOT NULL,
    status        VARCHAR(20)  NOT NULL,
    public_ip     VARCHAR(20),
    private_ip    VARCHAR(20)  NOT NULL,
    created_at    TIMESTAMP    NOT NULL
);

-- ============================================================
-- Table: dbo.storage_volumes
-- ============================================================
CREATE TABLE dbo.storage_volumes (
    volume_id    VARCHAR(50)  PRIMARY KEY,
    instance_id  VARCHAR(50)  NOT NULL REFERENCES dbo.compute_instances(instance_id),
    name         VARCHAR(100) NOT NULL,
    size_gb      INTEGER      NOT NULL,
    volume_type  VARCHAR(10)  NOT NULL,
    iops         INTEGER,
    status       VARCHAR(20)  NOT NULL,
    attached_at  TIMESTAMP
);

-- ============================================================
-- Table: dbo.dns_records
-- ============================================================
CREATE TABLE dbo.dns_records (
    record_id    VARCHAR(50)  PRIMARY KEY,
    network_id   VARCHAR(50)  NOT NULL REFERENCES dbo.networks(network_id),
    instance_id  VARCHAR(50)  NOT NULL REFERENCES dbo.compute_instances(instance_id),
    hostname     VARCHAR(200) NOT NULL,
    record_type  VARCHAR(10)  NOT NULL,
    value        VARCHAR(200) NOT NULL,
    ttl          INTEGER      NOT NULL,
    status       VARCHAR(20)  NOT NULL,
    created_at   TIMESTAMP    NOT NULL
);

-- ============================================================
-- Table: dbo.certificates
-- ============================================================
CREATE TABLE dbo.certificates (
    certificate_id VARCHAR(50)  PRIMARY KEY,
    dns_record_id  VARCHAR(50)  NOT NULL REFERENCES dbo.dns_records(record_id),
    domain         VARCHAR(200) NOT NULL,
    issuer         VARCHAR(100) NOT NULL,
    status         VARCHAR(20)  NOT NULL,
    issued_at      TIMESTAMP,
    expires_at     TIMESTAMP,
    created_at     TIMESTAMP    NOT NULL
);

-- ============================================================
-- Table: dbo.load_balancers
-- ============================================================
CREATE TABLE dbo.load_balancers (
    lb_id             VARCHAR(50)  PRIMARY KEY,
    network_id        VARCHAR(50)  NOT NULL REFERENCES dbo.networks(network_id),
    instance_id       VARCHAR(50)  NOT NULL REFERENCES dbo.compute_instances(instance_id),
    name              VARCHAR(100) NOT NULL,
    type              VARCHAR(10)  NOT NULL,
    port              INTEGER      NOT NULL,
    protocol          VARCHAR(10)  NOT NULL,
    health_check_path VARCHAR(200) NOT NULL,
    status            VARCHAR(20)  NOT NULL,
    created_at        TIMESTAMP    NOT NULL
);

-- ============================================================
-- Seed Data: Environments (2 records)
-- ============================================================
INSERT INTO dbo.environments (environment_id, name, type, region, account_id, status, created_at) VALUES
('ENV-DEV',     'Development',  'dev',     'us-east-1', 'aws-acct-111111111111', 'active', '2025-01-10 08:00:00'),
('ENV-STAGING', 'Staging',      'staging', 'us-west-2', 'aws-acct-222222222222', 'active', '2025-01-15 10:00:00');

-- ============================================================
-- Seed Data: Networks (3 records)
-- ============================================================
INSERT INTO dbo.networks (network_id, environment_id, name, vpc_cidr, subnet_cidr, availability_zone, status, created_at) VALUES
('NET-DEV-1', 'ENV-DEV',     'dev-vpc-primary',     '10.0.0.0/16', '10.0.1.0/24', 'us-east-1a', 'active', '2025-01-10 08:30:00'),
('NET-STG-1', 'ENV-STAGING', 'staging-vpc-primary',  '10.1.0.0/16', '10.1.1.0/24', 'us-west-2a', 'active', '2025-01-15 10:30:00'),
('NET-STG-2', 'ENV-STAGING', 'staging-vpc-secondary','10.2.0.0/16', '10.2.1.0/24', 'us-west-2b', 'active', '2025-01-15 11:00:00');

-- ============================================================
-- Seed Data: Compute Instances (6 records, 2 per network)
-- ============================================================
INSERT INTO dbo.compute_instances (instance_id, network_id, name, instance_type, ami_id, status, public_ip, private_ip, created_at) VALUES
-- NET-DEV-1 instances
('INST-DEV-1', 'NET-DEV-1', 'web-server-dev-1',  't3.medium',  'ami-0abcdef1234567890', 'running', '54.89.123.45',  '10.0.1.10',  '2025-01-10 09:00:00'),
('INST-DEV-2', 'NET-DEV-1', 'api-server-dev-1',  't3.medium',  'ami-0abcdef1234567890', 'running', NULL,            '10.0.1.11',  '2025-01-10 09:15:00'),
-- NET-STG-1 instances
('INST-STG-1', 'NET-STG-1', 'web-server-stg-1',  'm5.large',   'ami-0fedcba9876543210', 'running', '52.38.201.100', '10.1.1.10',  '2025-01-15 11:00:00'),
('INST-STG-2', 'NET-STG-1', 'api-server-stg-1',  'm5.large',   'ami-0fedcba9876543210', 'running', NULL,            '10.1.1.11',  '2025-01-15 11:15:00'),
-- NET-STG-2 instances
('INST-STG-3', 'NET-STG-2', 'worker-server-stg-1','c5.xlarge',  'ami-0fedcba9876543210', 'running', NULL,            '10.2.1.10',  '2025-01-15 11:30:00'),
('INST-STG-4', 'NET-STG-2', 'cache-server-stg-1', 't3.medium',  'ami-0fedcba9876543210', 'running', NULL,            '10.2.1.11',  '2025-01-15 11:45:00');

-- ============================================================
-- Seed Data: Storage Volumes (6 records, 1 per compute instance)
-- ============================================================
INSERT INTO dbo.storage_volumes (volume_id, instance_id, name, size_gb, volume_type, iops, status, attached_at) VALUES
('VOL-DEV-1', 'INST-DEV-1', 'web-server-dev-1-root',     50,  'gp3', NULL,  'in-use', '2025-01-10 09:05:00'),
('VOL-DEV-2', 'INST-DEV-2', 'api-server-dev-1-root',     50,  'gp3', NULL,  'in-use', '2025-01-10 09:20:00'),
('VOL-STG-1', 'INST-STG-1', 'web-server-stg-1-root',     100, 'gp3', NULL,  'in-use', '2025-01-15 11:05:00'),
('VOL-STG-2', 'INST-STG-2', 'api-server-stg-1-data',     200, 'io2', 5000,  'in-use', '2025-01-15 11:20:00'),
('VOL-STG-3', 'INST-STG-3', 'worker-server-stg-1-data',  500, 'io2', 10000, 'in-use', '2025-01-15 11:35:00'),
('VOL-STG-4', 'INST-STG-4', 'cache-server-stg-1-root',   100, 'gp3', NULL,  'in-use', '2025-01-15 11:50:00');

-- ============================================================
-- Seed Data: DNS Records (4 records)
-- ============================================================
INSERT INTO dbo.dns_records (record_id, network_id, instance_id, hostname, record_type, value, ttl, status, created_at) VALUES
('DNS-DEV-1', 'NET-DEV-1', 'INST-DEV-1', 'web-dev.internal.example.com',     'A',     '10.0.1.10',                        300,  'active', '2025-01-10 09:30:00'),
('DNS-STG-1', 'NET-STG-1', 'INST-STG-1', 'web-stg.staging.example.com',      'A',     '10.1.1.10',                        300,  'active', '2025-01-15 12:00:00'),
('DNS-STG-2', 'NET-STG-1', 'INST-STG-2', 'api-stg.staging.example.com',      'A',     '10.1.1.11',                        300,  'active', '2025-01-15 12:15:00'),
('DNS-STG-3', 'NET-STG-2', 'INST-STG-3', 'worker-stg.staging.example.com',   'CNAME', 'worker-server-stg-1.ec2.internal', 3600, 'active', '2025-01-15 12:30:00');

-- ============================================================
-- Seed Data: Certificates (3 records)
-- ============================================================
INSERT INTO dbo.certificates (certificate_id, dns_record_id, domain, issuer, status, issued_at, expires_at, created_at) VALUES
('CERT-DEV-1', 'DNS-DEV-1', 'web-dev.internal.example.com', 'LetsEncrypt', 'issued', '2025-01-10 10:00:00', '2026-01-10 10:00:00', '2025-01-10 09:45:00'),
('CERT-STG-1', 'DNS-STG-1', 'web-stg.staging.example.com', 'Amazon', 'issued', '2025-01-15 13:00:00', '2026-01-15 13:00:00', '2025-01-15 12:45:00'),
('CERT-STG-2', 'DNS-STG-2', 'api-stg.staging.example.com', 'Amazon', 'issued', '2025-01-15 13:15:00', '2026-01-15 13:15:00', '2025-01-15 13:00:00');

-- ============================================================
-- Seed Data: Load Balancers (3 records)
-- ============================================================
INSERT INTO dbo.load_balancers (lb_id, network_id, instance_id, name, type, port, protocol, health_check_path, status, created_at) VALUES
('LB-DEV-1',  'NET-DEV-1', 'INST-DEV-1', 'web-alb-dev-1', 'ALB', 443,  'HTTPS', '/health',     'active', '2025-01-10 10:00:00'),
('LB-STG-1',  'NET-STG-1', 'INST-STG-1', 'web-alb-stg-1', 'ALB', 443,  'HTTPS', '/health',     'active', '2025-01-15 13:30:00'),
('LB-STG-2',  'NET-STG-1', 'INST-STG-2', 'api-alb-stg-1', 'ALB', 8443, 'HTTPS', '/api/health', 'active', '2025-01-15 13:45:00');
