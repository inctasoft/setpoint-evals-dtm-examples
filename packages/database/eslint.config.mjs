// @ts-check
import eslint from "@eslint/js";
import eslintPluginPrettierRecommended from "eslint-plugin-prettier/recommended";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["eslint.config.mjs", "dist/**", "**/*.spec.ts", "**/*.test.ts"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
      sourceType: "commonjs",
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-floating-promises": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/await-thenable": "warn",
      "prettier/prettier": ["error", { endOfLine: "lf" }],
    },
  },
  {
    // TypeORM migration `down()` methods often legitimately have no await
    // (e.g. enum-removal migrations on PostgreSQL, where the down is a console.log
    // because PG doesn't support removing enum values). The `queryRunner` parameter
    // must remain in the signature to satisfy the MigrationInterface contract.
    files: ["src/migrations/**/*.ts"],
    rules: {
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_|^queryRunner$" },
      ],
    },
  },
);
