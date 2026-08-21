/**
 * pnpm Configuration
 * 
 * This file enforces best practices for the monorepo:
 * - Single node_modules at root
 * - Hoisted dependencies
 * - Workspace protocol for internal packages
 */

module.exports = {
  hooks: {
    readPackage(pkg) {
      // Ensure workspace packages use workspace protocol
      if (pkg.dependencies) {
        for (const [name, version] of Object.entries(pkg.dependencies)) {
          if (name.startsWith('@dtm/') && !version.startsWith('workspace:')) {
            console.warn(`⚠️  ${pkg.name}: ${name} should use workspace:* protocol`);
          }
        }
      }
      return pkg;
    }
  }
};

