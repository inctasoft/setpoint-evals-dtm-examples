#!/usr/bin/env node

/**
 * Deploy Infra-Provisioning Lambda Workers to LocalStack
 *
 * This script:
 * 1. Builds all Lambda handlers using esbuild (outputs to dist/)
 * 2. Creates deployment packages (zips) for each handler
 * 3. Deploys to LocalStack
 * 4. Sets up SQS triggers (ESM)
 *
 * Usage:
 *   node scripts/deploy-to-localstack.js              # Standard deployment
 *   node scripts/deploy-to-localstack.js --hot-reload  # Hot reload mode
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// Load environment variables from .env file
const envPath = path.resolve(__dirname, "../../../../.env");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf8");
  envContent.split("\n").forEach((line) => {
    if (line.trim() && !line.trim().startsWith("#")) {
      const [key, ...valueParts] = line.split("=");
      if (key && valueParts.length > 0) {
        const value = valueParts.join("=").trim();
        if (!process.env[key.trim()]) {
          process.env[key.trim()] = value;
        }
      }
    }
  });
  console.log(`\x1b[36m📄 Loaded environment from: ${envPath}\x1b[0m`);
}

// Configuration
const LOCALSTACK_ENDPOINT = process.env.AWS_ENDPOINT || `http://localhost:${process.env.LOCALSTACK_PORT || '4567'}`;
const AWS_REGION = process.env.AWS_REGION || "us-east-1";
const AWS_ACCOUNT_ID = process.env.AWS_ACCOUNT_ID || "000000000000";
const LAMBDA_WORKERS_DIR = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.resolve(__dirname, "../../../..");

/**
 * Handler configuration - maps Lambda function names to queue names
 *
 * Infra-Provisioning workflow handlers:
 * - Environment: plan + apply (root entity)
 * - Network: plan + apply (depends on environment)
 * - Compute: discover + plan + apply (fan-out pattern, depends on network)
 * - Storage: plan + apply (depends on network)
 * - DNS: plan + apply (depends on network)
 * - Certificate: plan + apply (depends on DNS)
 * - Load Balancer: plan + apply (depends on compute, storage, certificate)
 */
const HANDLERS = {
  // Environment (root entity)
  "infra-plan-environment": {
    handler: "plan-environment",
    queue: "infra-plan-environment",
    needsDb: true,
  },
  "infra-apply-environment": {
    handler: "apply-environment",
    queue: "infra-apply-environment",
    needsDb: false,
  },

  // Network (depends on environment)
  "infra-plan-network": {
    handler: "plan-network",
    queue: "infra-plan-network",
    needsDb: true,
  },
  "infra-apply-network": {
    handler: "apply-network",
    queue: "infra-apply-network",
    needsDb: false,
  },

  // Compute - Fan-out pattern (depends on network)
  "infra-discover-compute": {
    handler: "discover-compute",
    queue: "infra-discover-compute",
    needsDb: true,
  },
  "infra-plan-compute": {
    handler: "plan-compute",
    queue: "infra-plan-compute",
    needsDb: true,
  },
  "infra-apply-compute": {
    handler: "apply-compute",
    queue: "infra-apply-compute",
    needsDb: false,
  },

  // Storage (depends on network)
  "infra-plan-storage": {
    handler: "plan-storage",
    queue: "infra-plan-storage",
    needsDb: true,
  },
  "infra-apply-storage": {
    handler: "apply-storage",
    queue: "infra-apply-storage",
    needsDb: false,
  },

  // DNS (depends on network)
  "infra-plan-dns": {
    handler: "plan-dns",
    queue: "infra-plan-dns",
    needsDb: true,
  },
  "infra-apply-dns": {
    handler: "apply-dns",
    queue: "infra-apply-dns",
    needsDb: false,
  },

  // Certificate (depends on DNS)
  "infra-plan-certificate": {
    handler: "plan-certificate",
    queue: "infra-plan-certificate",
    needsDb: true,
  },
  "infra-apply-certificate": {
    handler: "apply-certificate",
    queue: "infra-apply-certificate",
    needsDb: false,
  },

  // Load Balancer (depends on compute, storage, certificate)
  "infra-plan-load-balancer": {
    handler: "plan-load-balancer",
    queue: "infra-plan-load-balancer",
    needsDb: true,
  },
  "infra-apply-load-balancer": {
    handler: "apply-load-balancer",
    queue: "infra-apply-load-balancer",
    needsDb: false,
  },

  // Record (final step — writes to product DB)
  "infra-record-provisioned-infra": {
    handler: "record-provisioned-infra",
    queue: "infra-record-provisioned-infra",
    needsDb: false,
    needsProductDb: true,
  },
};

// Colors for output
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  blue: "\x1b[34m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function exec(command, options = {}) {
  try {
    return execSync(command, {
      encoding: "utf-8",
      stdio: options.silent ? "pipe" : "inherit",
      ...options,
    });
  } catch (error) {
    if (!options.ignoreError) {
      throw error;
    }
    return null;
  }
}

function execWithRetry(command, options = {}, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return exec(command, { ...options, silent: true });
    } catch (error) {
      const errorMessage = error.stderr?.toString() || error.message;
      const isConflict =
        errorMessage.includes("ResourceConflictException") ||
        errorMessage.includes("update is in progress");

      if (isConflict && attempt < maxRetries) {
        log(`  ⏳ Resource busy, retrying... (${attempt}/${maxRetries})`, colors.yellow);
        execSync("sleep 2", { stdio: "ignore" });
        continue;
      }
      throw error;
    }
  }
}

/**
 * Build all handlers using esbuild
 */
function buildHandlers() {
  log("\n🏗️  Building Lambda handlers with esbuild...", colors.yellow);
  process.chdir(LAMBDA_WORKERS_DIR);
  exec("pnpm run build");
  log("  ✅ All handlers built", colors.green);
}

/**
 * Package a handler into a zip file
 */
function packageHandler(handlerName) {
  const distDir = path.join(LAMBDA_WORKERS_DIR, "dist", handlerName);
  const zipPath = path.join(LAMBDA_WORKERS_DIR, "dist", `${handlerName}.zip`);

  if (!fs.existsSync(distDir)) {
    return null;
  }

  // Remove old zip if exists
  if (fs.existsSync(zipPath)) {
    fs.unlinkSync(zipPath);
  }

  // Create zip
  process.chdir(distDir);
  exec(`zip -r ${zipPath} . -q`);

  return zipPath;
}

/**
 * Deploy a Lambda function
 */
function deployFunction(functionName, config, isHotReload) {
  const envVars = {
    ORCHESTRATOR_URL: "http://dtm-orchestrator:3000",
    NODE_ENV: "development",
    AWS_REGION: AWS_REGION,
    ENABLE_REQUESTS_FOR_SIMULATED_DELAYS:
      process.env.ENABLE_REQUESTS_FOR_SIMULATED_DELAYS || "false",
  };

  // Add DB connection for plan/discover handlers (they query source DB)
  if (config.needsDb) {
    Object.assign(envVars, {
      INFRA_PROVISIONING_DB_HOST: "dtm-db",
      INFRA_PROVISIONING_DB_PORT: "5432",
      INFRA_PROVISIONING_DB_USER: "infra_user",
      INFRA_PROVISIONING_DB_PASSWORD: "infra_pass",
      INFRA_PROVISIONING_DB_NAME: "infra_provisioning_db",
    });
  }

  // Add product DB connection for record handler
  if (config.needsProductDb) {
    Object.assign(envVars, {
      INFRA_PROVISIONING_PRODUCT_DB_HOST: "dtm-db",
      INFRA_PROVISIONING_PRODUCT_DB_PORT: "5432",
      INFRA_PROVISIONING_PRODUCT_DB_USER: "infra_user",
      INFRA_PROVISIONING_PRODUCT_DB_PASSWORD: "infra_pass",
      INFRA_PROVISIONING_PRODUCT_DB_NAME: "infra_provisioning_product_db",
    });
  }

  const envFile = path.join("/tmp", `lambda-env-${functionName}.json`);
  fs.writeFileSync(envFile, JSON.stringify({ Variables: envVars }));

  try {
    // Check if function exists
    const exists = exec(
      `aws --endpoint-url=${LOCALSTACK_ENDPOINT} lambda get-function --function-name ${functionName} --region ${AWS_REGION}`,
      { silent: true, ignoreError: true }
    );

    if (isHotReload) {
      // Hot reload mode - use S3 magic bucket
      const handlerPath = `workflows/infra-provisioning/workers/dist/${config.handler}/index.handler`;

      if (exists) {
        execWithRetry(
          `aws --endpoint-url=${LOCALSTACK_ENDPOINT} lambda update-function-code ` +
            `--function-name ${functionName} ` +
            `--s3-bucket hot-reload ` +
            `--s3-key "${PROJECT_ROOT}" ` +
            `--region ${AWS_REGION}`
        );
        execSync("sleep 1", { stdio: "ignore" });
        execWithRetry(
          `aws --endpoint-url=${LOCALSTACK_ENDPOINT} lambda update-function-configuration ` +
            `--function-name ${functionName} ` +
            `--handler ${handlerPath} ` +
            `--environment file://${envFile} ` +
            `--region ${AWS_REGION}`
        );
        return { action: "updated", success: true };
      }

      exec(
        `aws --endpoint-url=${LOCALSTACK_ENDPOINT} lambda create-function ` +
          `--function-name ${functionName} ` +
          `--runtime nodejs20.x ` +
          `--handler ${handlerPath} ` +
          `--role arn:aws:iam::${AWS_ACCOUNT_ID}:role/lambda-role ` +
          `--code S3Bucket=hot-reload,S3Key="${PROJECT_ROOT}" ` +
          `--timeout 15 ` +
          `--memory-size 512 ` +
          `--environment file://${envFile} ` +
          `--region ${AWS_REGION}`,
        { silent: true }
      );
      return { action: "created", success: true };
    } else {
      // Standard deployment - use zip file
      const zipPath = path.join(LAMBDA_WORKERS_DIR, "dist", `${config.handler}.zip`);

      if (!fs.existsSync(zipPath)) {
        return { action: "failed", success: false, error: "zip not found" };
      }

      if (exists) {
        execWithRetry(
          `aws --endpoint-url=${LOCALSTACK_ENDPOINT} lambda update-function-code ` +
            `--function-name ${functionName} ` +
            `--zip-file fileb://${zipPath} ` +
            `--region ${AWS_REGION}`
        );
        execSync("sleep 1", { stdio: "ignore" });
        execWithRetry(
          `aws --endpoint-url=${LOCALSTACK_ENDPOINT} lambda update-function-configuration ` +
            `--function-name ${functionName} ` +
            `--environment file://${envFile} ` +
            `--region ${AWS_REGION}`
        );
        return { action: "updated", success: true };
      }

      exec(
        `aws --endpoint-url=${LOCALSTACK_ENDPOINT} lambda create-function ` +
          `--function-name ${functionName} ` +
          `--runtime nodejs20.x ` +
          `--handler index.handler ` +
          `--role arn:aws:iam::${AWS_ACCOUNT_ID}:role/lambda-role ` +
          `--zip-file fileb://${zipPath} ` +
          `--timeout 15 ` +
          `--memory-size 512 ` +
          `--environment file://${envFile} ` +
          `--region ${AWS_REGION}`,
        { silent: true }
      );
      return { action: "created", success: true };
    }
  } catch (error) {
    return { action: "failed", success: false, error: error.message };
  } finally {
    if (fs.existsSync(envFile)) fs.unlinkSync(envFile);
  }
}

/**
 * Setup Event Source Mapping for SQS trigger
 */
function setupESM(functionName, queueName) {
  const queueArn = `arn:aws:sqs:${AWS_REGION}:${AWS_ACCOUNT_ID}:${queueName}`;

  // Check if ESM already exists
  const existing = exec(
    `aws --endpoint-url=${LOCALSTACK_ENDPOINT} lambda list-event-source-mappings ` +
      `--function-name ${functionName} ` +
      `--query "EventSourceMappings[?EventSourceArn=='${queueArn}'].UUID" ` +
      `--output text ` +
      `--region ${AWS_REGION}`,
    { silent: true, ignoreError: true }
  );

  if (existing?.trim()) {
    return { action: "exists", success: true };
  }

  try {
    exec(
      `aws --endpoint-url=${LOCALSTACK_ENDPOINT} lambda create-event-source-mapping ` +
        `--function-name ${functionName} ` +
        `--event-source-arn ${queueArn} ` +
        `--batch-size 1 ` +
        `--maximum-batching-window-in-seconds 0 ` +
        `--enabled ` +
        `--region ${AWS_REGION}`,
      { silent: true }
    );

    exec(
      `aws --endpoint-url=${LOCALSTACK_ENDPOINT} lambda put-function-concurrency ` +
        `--function-name ${functionName} ` +
        `--reserved-concurrent-executions 10 ` +
        `--region ${AWS_REGION}`,
      { silent: true, ignoreError: true }
    );

    return { action: "created", success: true };
  } catch (error) {
    return { action: "failed", success: false };
  }
}

function main() {
  log("╔══════════════════════════════════════════════════════╗", colors.blue);
  log("║   Infra Provisioning Lambda Workers Deployment      ║", colors.blue);
  log("╚══════════════════════════════════════════════════════╝", colors.blue);
  console.log();

  const isHotReload = process.argv.includes("--hot-reload");
  const USE_POLLER = process.env.USE_POLLER === "true";

  if (isHotReload) {
    log("🔥 HOT RELOAD MODE ENABLED", colors.magenta);
  }

  // Step 1: Build (skip in hot reload)
  if (!isHotReload) {
    log("\n📦 Step 1: Building handlers...", colors.yellow);
    buildHandlers();

    // Package each handler
    log("\n📦 Step 2: Packaging handlers...", colors.yellow);
    for (const [, config] of Object.entries(HANDLERS)) {
      const zipPath = packageHandler(config.handler);
      if (zipPath) {
        log(`  ✅ ${config.handler}.zip`, colors.green);
      } else {
        log(`  ⚠️  ${config.handler} - dist not found`, colors.yellow);
      }
    }
  }

  // Step 3: Deploy functions
  const step = isHotReload ? 1 : 3;
  log(`\n📤 Step ${step}: Deploying Lambda functions...`, colors.yellow);
  console.log();

  const stats = { created: 0, updated: 0, failed: 0 };

  for (const [functionName, config] of Object.entries(HANDLERS)) {
    const result = deployFunction(functionName, config, isHotReload);
    const badge = config.needsDb
      ? `${colors.magenta}[DB]${colors.reset}`
      : `${colors.cyan}[PROCESSING]${colors.reset}`;

    if (result.success) {
      if (result.action === "created") {
        log(`  ✅ ${functionName} ${badge}`, colors.green);
        stats.created++;
      } else {
        log(`  🔄 ${functionName} ${badge} (updated)`, colors.cyan);
        stats.updated++;
      }
    } else {
      log(`  ❌ ${functionName} ${badge} - ${result.error || "failed"}`, colors.red);
      stats.failed++;
    }
  }

  console.log();
  log(`  Created: ${stats.created}, Updated: ${stats.updated}, Failed: ${stats.failed}`, colors.cyan);

  // Step 4: ESM setup (if not using poller AND ESM explicitly enabled)
  // ESM mode requires explicit opt-in — free LocalStack is flaky with ESM v2.
  // See docs/guides/DEPLOYMENT-MODES.md for details.
  const ESM_ENABLED = process.env.ENABLE_LAMBDA_WITH_ESM_LOCALSTACK_DEPLOYMENT === 'true';
  if (!USE_POLLER && ESM_ENABLED) {
    const esmStep = isHotReload ? 2 : 4;
    log(`\n🔗 Step ${esmStep}: Setting up Event Source Mappings...`, colors.yellow);
    console.log();

    let esmCount = 0;
    for (const [functionName, config] of Object.entries(HANDLERS)) {
      const result = setupESM(functionName, config.queue);
      if (result.success) {
        if (result.action === "exists") {
          log(`  ⏭️  ${config.queue} → ${functionName} (exists)`, colors.cyan);
        } else {
          log(`  ✅ ${config.queue} → ${functionName}`, colors.green);
        }
        esmCount++;
      } else {
        log(`  ❌ ${config.queue} → ${functionName}`, colors.red);
      }
    }

    console.log();
    log(`  ESMs configured: ${esmCount}/${Object.keys(HANDLERS).length}`, colors.green);
  } else if (!USE_POLLER && !ESM_ENABLED) {
    log(`\n⚠️  ESM mode requested but ENABLE_LAMBDA_WITH_ESM_LOCALSTACK_DEPLOYMENT is not set`, colors.yellow);
    log(`   ESMs will NOT be created. Set the env var to enable ESM deployment.`, colors.yellow);
    log(`   See docs/guides/DEPLOYMENT-MODES.md for details.`, colors.yellow);
  } else {
    log(`\n⏭️  ESM creation skipped (Poller mode)`, colors.yellow);
  }

  // Summary
  console.log();
  log("╔══════════════════════════════════════════════════════╗", colors.blue);
  log("║   Deployment Summary                                ║", colors.blue);
  log("╚══════════════════════════════════════════════════════╝", colors.blue);
  console.log();
  log(`  📦 Handlers deployed: ${Object.keys(HANDLERS).length}`, colors.cyan);
  log(`  🎯 Target: ${LOCALSTACK_ENDPOINT}`, colors.cyan);
  log(`  🔧 Mode: ${USE_POLLER ? "Poller" : "ESM"}`, colors.cyan);
  console.log();
  log("✅ Deployment complete!", colors.green);
}

try {
  main();
} catch (error) {
  log("❌ Deployment failed!", colors.red);
  console.error(error);
  process.exit(1);
}
