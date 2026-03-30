// Jest setup file to provide Node.js globals
const { webcrypto } = require('node:crypto');

// Make crypto available globally for TypeORM and other packages
if (!global.crypto) {
  global.crypto = webcrypto;
}

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.DATABASE_HOST = 'localhost';
process.env.DATABASE_PORT = '5432';
process.env.DATABASE_USER = 'pp_admin';
process.env.DATABASE_PASSWORD = 'passwd';
process.env.DATABASE_NAME = 'pp_db';
