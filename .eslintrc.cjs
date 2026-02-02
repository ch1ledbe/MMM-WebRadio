/** @type {import('eslint').Linter.Config} */
module.exports = {
  env: {
    node: true,
    es2021: true
  },
  extends: ["eslint:recommended"],
  parserOptions: {
    ecmaVersion: 2021,
    sourceType: "script"
  },
  rules: {
    // MagicMirror / Node realities
    "no-console": "off",
    "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    "no-undef": "error",

    // Avoid false positives in async / IPC code
    "no-empty": "warn",

    // Be tolerant with legacy patterns
    "prefer-const": "warn"
  },
  ignorePatterns: [
    "node_modules/",
    "public/",
    "vendor/",
    "*.min.js"
  ]
};
