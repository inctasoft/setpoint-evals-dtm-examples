#!/usr/bin/env node

/**
 * Deploy IoT Sensor Pipeline Lambda Workers to LocalStack
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
 * IoT Sensor Pipeline workflow handlers:
 * - Device: register + provision (root entity)
 * - Sensor: discover + calibrate + activate (fan-out from device)
 * - Reading: discover + ingest + publish (nested fan-out from sensor)
 * - Alert: evaluate + dispatch (conditional from reading)
 * - Aggregate: compute + publish (from readings)
 */
const HANDLERS = {
  // Device (root entity)
  "iot-register-device": {
    handler: "register-device",
    queue: "iot-register-device",
    needsDb: true,
  },
  "iot-provision-device": {
    handler: "provision-device",
    queue: "iot-provision-device",
    needsDb: false,
  },

  // Sensor (fan-out from device)
  "iot-discover-sensors": {
    handler: "discover-sensors",
    queue: "iot-discover-sensors",
    needsDb: true,
  },
  "iot-calibrate-sensor": {
    handler: "calibrate-sensor",
    queue: "iot-calibrate-sensor",
    needsDb: true,
  },
  "iot-activate-sensor": {
    handler: "activate-sensor",
    queue: "iot-activate-sensor",
    needsDb: false,
  },

  // Reading (nested fan-out from sensor)
  "iot-discover-readings": {
    handler: "discover-readings",
    queue: "iot-discover-readings",
    needsDb: true,
  },
  "iot-ingest-reading": {
    handler: "ingest-reading",
    queue: "iot-ingest-reading",
    needsDb: true,
  },
  "iot-publish-reading": {
    handler: "publish-reading",
    queue: "iot-publish-reading",
    needsDb: false,
  },

  // Alert (conditional from reading)
  "iot-evaluate-alert": {
    handler: "evaluate-alert",
    queue: "iot-evaluate-alert",
    needsDb: true,
  },
  "iot-dispatch-alert": {
    handler: "dispatch-alert",
    queue: "iot-dispatch-alert",
    needsDb: false,
  },

  // Aggregate (from readings)
  "iot-compute-aggregate": {
    handler: "compute-aggregate",
    queue: "iot-compute-aggregate",
    needsDb: true,
  },
  "iot-publish-aggregate": {
    handler: "publish-aggregate",
    queue: "iot-publish-aggregate",
    needsDb: false,
  },

  // Archive (final step — writes to product DB)
  "iot-archive-processed-pipeline": {
    handler: "archive-processed-pipeline",
    queue: "iot-archive-processed-pipeline",
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

  // Add DB connection for handlers that query source DB
  if (config.needsDb) {
    Object.assign(envVars, {
      IOT_SENSOR_DB_HOST: "dtm-db",
      IOT_SENSOR_DB_PORT: "5432",
      IOT_SENSOR_DB_USER: "iot_user",
      IOT_SENSOR_DB_PASSWORD: "iot_pass",
      IOT_SENSOR_DB_NAME: "iot_sensor_pipeline_db",
    });
  }

  // Add product DB connection for archive handler
  if (config.needsProductDb) {
    Object.assign(envVars, {
      IOT_SENSOR_PIPELINE_PRODUCT_DB_HOST: "dtm-db",
      IOT_SENSOR_PIPELINE_PRODUCT_DB_PORT: "5432",
      IOT_SENSOR_PIPELINE_PRODUCT_DB_USER: "iot_user",
      IOT_SENSOR_PIPELINE_PRODUCT_DB_PASSWORD: "iot_pass",
      IOT_SENSOR_PIPELINE_PRODUCT_DB_NAME: "iot_sensor_pipeline_product_db",
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
      const handlerPath = `workflows/iot-sensor-pipeline/workers/dist/${config.handler}/index.handler`;

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
  log("║   IoT Sensor Pipeline Lambda Workers Deployment    ║", colors.blue);
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
