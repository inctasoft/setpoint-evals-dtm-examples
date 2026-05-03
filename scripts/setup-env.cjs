#!/usr/bin/env node
/**
 * Environment Setup Script
 *
 * Creates .env from .env.example template.
 * The application uses runtime detection to auto-configure for:
 * - Local development (localhost with mapped ports)
 * - Docker (Docker service names)
 * - EKS (uses ConfigMap/Secrets directly)
 *
 * This means you only need ONE .env file that works in all modes!
 *
 * Usage: node scripts/setup-env.cjs [--force]
 */

const fs = require("fs");
const path = require("path");

// Configuration
const PROJECT_ROOT = path.resolve(__dirname, "..");
const ENV_EXAMPLE = path.join(PROJECT_ROOT, ".env.example");
const TARGET_ENV = path.join(PROJECT_ROOT, ".env");

// Orchestrator service needs a symlink to root .env
const ORCHESTRATOR_DIR = path.join(PROJECT_ROOT, "services", "orchestrator");
const ORCHESTRATOR_ENV_LINK = path.join(ORCHESTRATOR_DIR, ".env");

// Legacy files (for backward compatibility during migration)
const DEV_EXAMPLE = path.join(PROJECT_ROOT, ".env.example");
const TEST_EXAMPLE = path.join(PROJECT_ROOT, ".env.test.example");
const TARGET_ENV_DEV = path.join(PROJECT_ROOT, ".env");
const TARGET_ENV_TEST = path.join(PROJECT_ROOT, ".env.test");

console.log("🔧 Environment Setup Script");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log(`Example Template: ${path.basename(ENV_EXAMPLE)}`);
console.log(`Target: ${path.basename(TARGET_ENV)}`);
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

/**
 * Check if example files exist
 */
function checkExamples() {
  // Check for new consolidated .env.example first
  if (fs.existsSync(ENV_EXAMPLE)) {
    console.log("✅ Found .env.example (consolidated template)");
    return "new";
  }

  // Fall back to legacy example files
  const missing = [];
  if (!fs.existsSync(DEV_EXAMPLE)) missing.push(".env.example");
  if (!fs.existsSync(TEST_EXAMPLE)) missing.push(".env.test.example");

  if (missing.length === 0) {
    console.log("ℹ️  Using legacy example files (.env.example, .env.test.example)");
    return "legacy";
  }

  console.log(`❌ Missing example files: ${missing.join(", ")}`);
  console.log("   Please ensure .env.example exists.\n");
  process.exit(1);
}

/**
 * Copy example file to target
 */
function copyEnvFile(source, target, description) {
  console.log(`\n📝 Creating ${description}...`);
  const content = fs.readFileSync(source, "utf8");
  fs.writeFileSync(target, content, "utf8");
  console.log(`✅ Created: ${path.relative(PROJECT_ROOT, target)}`);
}

/**
 * Create symlink for orchestrator service
 * The orchestrator runs from its own directory, so it needs a symlink to the root .env
 */
function createOrchestratorSymlink() {
  console.log("\n🔗 Setting up orchestrator .env symlink...");
  
  // Relative path from orchestrator dir to root .env
  const relativePath = "../../.env";
  
  try {
    // Check if symlink already exists and points to correct location
    if (fs.existsSync(ORCHESTRATOR_ENV_LINK)) {
      const stats = fs.lstatSync(ORCHESTRATOR_ENV_LINK);
      if (stats.isSymbolicLink()) {
        const target = fs.readlinkSync(ORCHESTRATOR_ENV_LINK);
        if (target === relativePath) {
          console.log("✅ Orchestrator .env symlink already configured");
          return;
        }
      }
      // Remove existing file/symlink that doesn't match
      fs.unlinkSync(ORCHESTRATOR_ENV_LINK);
    }
    
    // Create the symlink
    fs.symlinkSync(relativePath, ORCHESTRATOR_ENV_LINK);
    console.log(`✅ Created: services/orchestrator/.env -> ${relativePath}`);
  } catch (error) {
    console.log(`⚠️  Could not create orchestrator symlink: ${error.message}`);
    console.log("   You may need to create it manually:");
    console.log(`   cd services/orchestrator && ln -sf ${relativePath} .env`);
  }
}

/**
 * Main execution
 */
function main() {
  try {
    // Check for --force flag
    const forceOverwrite = process.argv.includes("--force");

    // Check which example files exist
    const mode = checkExamples();

    // Check if target .env already exists
    const envExists = fs.existsSync(TARGET_ENV);

    if (mode === "new") {
      // New consolidated approach - single .env file
      if (envExists && !forceOverwrite) {
        console.log("\n✅ Environment file already exists: .env");
        console.log("   Skipping creation.");
        console.log("   To recreate, run: pnpm run setup:env:force\n");
      } else {
        if (forceOverwrite && envExists) {
          console.log("\n⚠️  Force flag detected - overwriting existing .env...\n");
        }
        copyEnvFile(ENV_EXAMPLE, TARGET_ENV, ".env from .env.example");
      }

      // Create orchestrator symlink
      createOrchestratorSymlink();

      console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log("✅ Environment setup complete!");
      console.log("\n📋 Runtime Detection:");
      console.log("   The app auto-detects its runtime environment:");
      console.log("   • Local:  Uses localhost with mapped ports (5448, 9093, 4566)");
      console.log("   • Docker: Uses Docker service names (dtm-db, dtm-kafka, localstack)");
      console.log("   • EKS:    Uses env vars from ConfigMap/Secrets");
      console.log("\n💡 No need to switch .env files between modes!");
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    } else {
      // Legacy mode - maintain backward compatibility
      const devExists = fs.existsSync(TARGET_ENV_DEV);
      const testExists = fs.existsSync(TARGET_ENV_TEST);

      if (forceOverwrite && (devExists || testExists || envExists)) {
        console.log("\n⚠️  Force flag detected - overwriting existing files...\n");
      } else if (devExists && testExists && envExists) {
        console.log("\n✅ Environment files already exist:");
        console.log("   • .env");
        console.log("   • .env.test");
        console.log("   • .env");
        console.log("\n   Skipping environment file creation");
        console.log("   To recreate, run: pnpm run setup:env:force\n");
      }

      // Copy environment files (only if they don't exist or force flag)
      if (!devExists || forceOverwrite) {
        copyEnvFile(DEV_EXAMPLE, TARGET_ENV_DEV, ".env");
      }
      if (!testExists || forceOverwrite) {
        copyEnvFile(TEST_EXAMPLE, TARGET_ENV_TEST, ".env.test");
      }
      
      // Always create .env from .env for Docker Compose
      if (!envExists || forceOverwrite) {
        console.log(`\n📝 Creating main .env file for Docker Compose...`);
        const devContent = fs.readFileSync(TARGET_ENV_DEV, "utf8");
        fs.writeFileSync(TARGET_ENV, devContent, "utf8");
        console.log(`✅ Created: ${path.relative(PROJECT_ROOT, TARGET_ENV)}`);
        console.log("   (Copied from .env for Docker Compose compatibility)");
      }

      // Create orchestrator symlink
      createOrchestratorSymlink();

      console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log("✅ Environment files created successfully!");
      console.log("\nNote: Consider migrating to the new consolidated .env.example approach.");
      console.log("      The app now supports runtime detection - no more file switching!");
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    }
  } catch (error) {
    console.error("\n❌ Error:", error.message);
    process.exit(1);
  }
}

main();
