// ESLint config: npm install (dev tools only, the site itself has no dependencies), then npm run lint.
import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["vendor/**", "node_modules/**", ".local/**", "samples/**"] },
  js.configs.recommended,
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      "no-unused-vars": ["warn", { args: "after-used", argsIgnorePattern: "^_", caughtErrors: "none" }],
      "no-shadow": "warn",
      "no-use-before-define": ["warn", { functions: false, classes: true, variables: false }], // (only same-scope uses: a function may name what is defined after it)
      "prefer-const": "warn",
      "no-var": "warn",
      eqeqeq: ["warn", "smart"],
    },
  },
];
