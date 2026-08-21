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
-- Story: two European regions, "staging-eu" and "prod-eu". See
-- ../SEED-REGISTRY.md for the full row->SE map and why compute instances
-- are shared per-environment while storage/dns/certificate/load_balancer
-- are per-SE isolated (worker lookup semantics, explained there).
-- ============================================================

-- ============================================================
-- Seed Data: Environments (2 records)
-- staging-eu / prod-eu assigned; qa-eu / dr-eu RESERVED for future SEs;
-- atlantis-eu = not-found sentinel
-- ============================================================
INSERT INTO dbo.environments (environment_id, name, type, region, account_id, status, created_at) VALUES
('staging-eu', 'Staging EU',    'staging', 'eu-west-1',    'aws-acct-111111111111', 'active', '2025-01-10 08:00:00'),
('prod-eu',    'Production EU', 'prod',    'eu-central-1', 'aws-acct-222222222222', 'active', '2025-01-15 10:00:00');

-- ============================================================
-- Seed Data: Networks (2 records — exactly one per environment; PlanNetwork
-- looks up by environment_id with findOne, so an environment with >1 network
-- would be ambiguous. See SEED-REGISTRY.md "Worker behavior notes".)
-- ============================================================
INSERT INTO dbo.networks (network_id, environment_id, name, vpc_cidr, subnet_cidr, availability_zone, status, created_at) VALUES
('NET-STAGING-EU-1', 'staging-eu', 'staging-eu-vpc-primary', '10.0.0.0/16', '10.0.1.0/24', 'eu-west-1a',    'active', '2025-01-10 08:30:00'),
('NET-PROD-EU-1',    'prod-eu',    'prod-eu-vpc-primary',    '10.1.0.0/16', '10.1.1.0/24', 'eu-central-1a', 'active', '2025-01-15 10:30:00');

-- ============================================================
-- Seed Data: Compute Instances (8 records)
-- staging-eu: 2 instances (SE-01, SE-05 — one each, dedicated)
-- prod-eu:    6 instances (SE-03 fan-out breadth; instance 1 also carries
--             SE-04's dedicated storage/dns/certificate/load_balancer chain)
-- ============================================================
INSERT INTO dbo.compute_instances (instance_id, network_id, name, instance_type, ami_id, status, public_ip, private_ip, created_at) VALUES
-- staging-eu (SE-01 happy-path, SE-05 long-ack-wait)
('INST-STAGING-EU-1', 'NET-STAGING-EU-1', 'web-staging-eu-1', 't3.medium', 'ami-0abcdef1234567890', 'running', '54.89.10.1', '10.0.1.10', '2025-01-10 09:00:00'),
('INST-STAGING-EU-2', 'NET-STAGING-EU-1', 'api-staging-eu-1', 't3.medium', 'ami-0abcdef1234567890', 'running', NULL,        '10.0.1.11', '2025-01-10 09:15:00'),
-- prod-eu (SE-03 compute-fan-out — 6 instances; SE-04 cascade-failure uses instance 1)
('INST-PROD-EU-1', 'NET-PROD-EU-1', 'web-prod-eu-1',    'm5.large',  'ami-0fedcba9876543210', 'running', '52.38.20.1', '10.1.1.10', '2025-01-15 11:00:00'),
('INST-PROD-EU-2', 'NET-PROD-EU-1', 'web-prod-eu-2',    'm5.large',  'ami-0fedcba9876543210', 'running', '52.38.20.2', '10.1.1.11', '2025-01-15 11:05:00'),
('INST-PROD-EU-3', 'NET-PROD-EU-1', 'api-prod-eu-1',    'm5.large',  'ami-0fedcba9876543210', 'running', NULL,         '10.1.1.12', '2025-01-15 11:10:00'),
('INST-PROD-EU-4', 'NET-PROD-EU-1', 'api-prod-eu-2',    'm5.large',  'ami-0fedcba9876543210', 'running', NULL,         '10.1.1.13', '2025-01-15 11:15:00'),
('INST-PROD-EU-5', 'NET-PROD-EU-1', 'worker-prod-eu-1', 'c5.xlarge', 'ami-0fedcba9876543210', 'running', NULL,         '10.1.1.14', '2025-01-15 11:20:00'),
('INST-PROD-EU-6', 'NET-PROD-EU-1', 'cache-prod-eu-1',  't3.medium', 'ami-0fedcba9876543210', 'running', NULL,         '10.1.1.15', '2025-01-15 11:25:00');

-- ============================================================
-- Seed Data: Storage Volumes (8 records, 1 per compute instance)
-- ============================================================
INSERT INTO dbo.storage_volumes (volume_id, instance_id, name, size_gb, volume_type, iops, status, attached_at) VALUES
('VOL-STAGING-EU-1', 'INST-STAGING-EU-1', 'web-staging-eu-1-root',  50,  'gp3', NULL,  'in-use', '2025-01-10 09:05:00'),
('VOL-STAGING-EU-2', 'INST-STAGING-EU-2', 'api-staging-eu-1-root',  50,  'gp3', NULL,  'in-use', '2025-01-10 09:20:00'),
('VOL-PROD-EU-1',    'INST-PROD-EU-1',    'web-prod-eu-1-root',     100, 'gp3', NULL,  'in-use', '2025-01-15 11:05:00'),
('VOL-PROD-EU-2',    'INST-PROD-EU-2',    'web-prod-eu-2-root',     100, 'gp3', NULL,  'in-use', '2025-01-15 11:10:00'),
('VOL-PROD-EU-3',    'INST-PROD-EU-3',    'api-prod-eu-1-data',     200, 'io2', 5000,  'in-use', '2025-01-15 11:15:00'),
('VOL-PROD-EU-4',    'INST-PROD-EU-4',    'api-prod-eu-2-data',     200, 'io2', 5000,  'in-use', '2025-01-15 11:20:00'),
('VOL-PROD-EU-5',    'INST-PROD-EU-5',    'worker-prod-eu-1-data',  500, 'io2', 10000, 'in-use', '2025-01-15 11:25:00'),
('VOL-PROD-EU-6',    'INST-PROD-EU-6',    'cache-prod-eu-1-root',   100, 'gp3', NULL,  'in-use', '2025-01-15 11:30:00');

-- ============================================================
-- Seed Data: DNS Records (3 records — one per SE that reaches PlanDNS)
-- ============================================================
INSERT INTO dbo.dns_records (record_id, network_id, instance_id, hostname, record_type, value, ttl, status, created_at) VALUES
('DNS-STAGING-EU-1', 'NET-STAGING-EU-1', 'INST-STAGING-EU-1', 'web-staging-eu.internal.example.com', 'A', '10.0.1.10', 300, 'active', '2025-01-10 09:30:00'),
('DNS-STAGING-EU-2', 'NET-STAGING-EU-1', 'INST-STAGING-EU-2', 'api-staging-eu.internal.example.com', 'A', '10.0.1.11', 300, 'active', '2025-01-10 09:35:00'),
-- SE-04 cascade-failure-propagation: this record exists (PlanDNS succeeds),
-- but ApplyDNS is configured via testOptions.failureAfter to fail permanently
-- — the SKIPPED-propagation story is a testOptions failure, not a missing row.
('DNS-PROD-EU-1', 'NET-PROD-EU-1', 'INST-PROD-EU-1', 'web-prod-eu.example.com', 'A', '10.1.1.10', 300, 'active', '2025-01-15 12:00:00');

-- ============================================================
-- Seed Data: Certificates (3 records)
-- ============================================================
INSERT INTO dbo.certificates (certificate_id, dns_record_id, domain, issuer, status, issued_at, expires_at, created_at) VALUES
('CERT-STAGING-EU-1', 'DNS-STAGING-EU-1', 'web-staging-eu.internal.example.com', 'LetsEncrypt', 'issued', '2025-01-10 10:00:00', '2026-01-10 10:00:00', '2025-01-10 09:45:00'),
('CERT-STAGING-EU-2', 'DNS-STAGING-EU-2', 'api-staging-eu.internal.example.com', 'LetsEncrypt', 'issued', '2025-01-10 10:15:00', '2026-01-10 10:15:00', '2025-01-10 10:00:00'),
('CERT-PROD-EU-1',    'DNS-PROD-EU-1',    'web-prod-eu.example.com',             'Amazon',      'issued', '2025-01-15 13:00:00', '2026-01-15 13:00:00', '2025-01-15 12:45:00');

-- ============================================================
-- Seed Data: Load Balancers (3 records)
-- ============================================================
INSERT INTO dbo.load_balancers (lb_id, network_id, instance_id, name, type, port, protocol, health_check_path, status, created_at) VALUES
('LB-STAGING-EU-1', 'NET-STAGING-EU-1', 'INST-STAGING-EU-1', 'web-alb-staging-eu', 'ALB', 443, 'HTTPS', '/health', 'active', '2025-01-10 10:00:00'),
('LB-STAGING-EU-2', 'NET-STAGING-EU-1', 'INST-STAGING-EU-2', 'api-alb-staging-eu', 'ALB', 8443, 'HTTPS', '/api/health', 'active', '2025-01-10 10:05:00'),
('LB-PROD-EU-1',    'NET-PROD-EU-1',    'INST-PROD-EU-1',    'web-alb-prod-eu',    'ALB', 443, 'HTTPS', '/health', 'active', '2025-01-15 13:30:00');
