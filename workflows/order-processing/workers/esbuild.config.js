#!/usr/bin/env node

/**
 * esbuild Configuration for Lambda Workers
 *
 * This script builds all Lambda handlers into separate bundles.
 * Each handler gets its own directory in dist/ with an index.js file.
 *
 * Output structure:
 *   dist/
 *   ├── validate-customer/
 *   │   └── index.js
 *   ├── validate-product/
 *   │   └── index.js
 *   ├── submit-customer/
 *   │   └── index.js
 *   └── ...
 *
 * Usage:
 *   node esbuild.config.js           # Build all handlers
 *   node esbuild.config.js --watch   # Watch mode
 */

const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

// All handlers to build
const HANDLERS = [
  // Customer (no fan-out, single mode)
  "validate-customer",
  "submit-customer",

  // Product (no fan-out, validate-only)
  "validate-product",

  // Order (no fan-out, single mode)
  "validate-order",
  "submit-order",

  // Line Items - Fan-out pattern
  "discover-line-items",    // Fan-out only: finds line item IDs
  "validate-line-item",     // Fan-out: validates single line item by ID
  "submit-line-item",       // Fan-out: submits single line item

  // Payment (no fan-out, single mode)
  "validate-payment",
  "submit-payment",

  // Shipment (no fan-out, single mode)
  "validate-shipment",
  "submit-shipment",
  "archive-processed-order",
];

// Common esbuild options
const commonOptions = {
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  sourcemap: true,
  minify: false, // Keep readable for debugging
  // External packages (use Lambda runtime or layers)
  external: [
    // AWS SDK is provided by Lambda runtime
    "@aws-sdk/*",
    "aws-sdk",
    // Heavy packages that should be in a layer
    "pg-native",
  ],
  // Tree-shaking
  treeShaking: true,
  // Resolve workspace packages
  mainFields: ["main", "module"],
  resolveExtensions: [".ts", ".js", ".json"],
};

async function build() {
  const isWatch = process.argv.includes("--watch");
  const distDir = path.join(__dirname, "dist");

  // Clean dist directory
  if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true });
  }
  fs.mkdirSync(distDir, { recursive: true });

  console.log("Building Lambda handlers...\n");

  const startTime = Date.now();

  // Build all handlers in parallel
  const builds = HANDLERS.map(async (handler) => {
    const entryPoint = path.join(__dirname, "src", "handlers", `${handler}.ts`);
    const outDir = path.join(distDir, handler);

    // Check if handler exists
    if (!fs.existsSync(entryPoint)) {
      console.log(`  [SKIP] ${handler} - skipped (file not found)`);
      return null;
    }

    try {
      if (isWatch) {
        // Watch mode - create a context
        const ctx = await esbuild.context({
          ...commonOptions,
          entryPoints: [entryPoint],
          outfile: path.join(outDir, "index.js"),
        });
        await ctx.watch();
        console.log(`  [WATCH] ${handler} - watching`);
        return ctx;
      } else {
        // Single build
        await esbuild.build({
          ...commonOptions,
          entryPoints: [entryPoint],
          outfile: path.join(outDir, "index.js"),
        });
        console.log(`  [OK] ${handler}`);
        return true;
      }
    } catch (error) {
      console.error(`  [FAIL] ${handler} - ${error.message}`);
      return null;
    }
  });

  const results = await Promise.all(builds);
  const successful = results.filter((r) => r !== null).length;
  const failed = HANDLERS.length - successful;

  const elapsed = Date.now() - startTime;

  console.log(`\nBuild complete in ${elapsed}ms`);
  console.log(`   Successful: ${successful}/${HANDLERS.length}`);

  if (failed > 0) {
    console.log(`   Failed: ${failed}`);
    if (!isWatch) {
      process.exit(1);
    }
  }

  if (isWatch) {
    console.log("\nWatching for changes...");
  }
}

// Run build
build().catch((error) => {
  console.error("Build failed:", error);
  process.exit(1);
});
