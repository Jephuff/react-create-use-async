module.exports = {
  parserOptions: { sourceType: "module" },
  plugins: ["prettier", "@typescript-eslint"],
  parser: "@typescript-eslint/parser",
  rules: {
    "prettier/prettier": [1, { trailingComma: "es5" }]
  },
  extends: ["prettier"]
};
