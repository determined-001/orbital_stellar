import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

/**
 * Flat ESLint config for the published packages (`packages/*`).
 *
 * `apps/web` is intentionally excluded — it lints via Next.js (`next lint`).
 * Formatting rules are delegated to Prettier (`eslint-config-prettier`).
 *
 * Rule philosophy: type-safety and correctness rules are errors (they block
 * CI); stylistic / pedantic rules that the existing code base trips on are
 * warnings — visible tech debt to burn down, not a wall.
 */
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/*.config.{js,mjs,cjs,ts}",
      "**/test/integration/**",
      "apps/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    files: ["packages/**/*.{ts,tsx,js,mjs,cjs}"],
    rules: {
      // TypeScript resolves identifiers itself; core no-undef double-reports
      // globals (process, Buffer, setTimeout, …). Off per typescript-eslint guidance.
      "no-undef": "off",
      // The SDK deliberately works with untyped RPC/JSON payloads at the edges.
      "@typescript-eslint/no-explicit-any": "off",
      // Allow intentionally-unused args/vars when prefixed with `_`.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      // Empty catch blocks are an intentional "ignore and continue" in a few places.
      "no-empty": ["error", { allowEmptyCatch: true }],
      // Existing tech debt — surfaced as warnings, not blockers.
      "@typescript-eslint/no-require-imports": "warn",
      // Allow `interface X extends Y {}` — used for type-alias indirection.
      "@typescript-eslint/no-empty-object-type": ["warn", { allowInterfaces: "with-single-extends" }],
      "@typescript-eslint/no-unused-expressions": "warn",
      "@typescript-eslint/ban-ts-comment": "warn",
      // Off: false-positives on fallback inits / TS definite-assignment patterns.
      "no-useless-assignment": "off",
      "no-case-declarations": "warn",
      // Rethrows without `{ cause }` — good practice, surfaced as warnings to burn down.
      "preserve-caught-error": "warn",
    },
  },
);
