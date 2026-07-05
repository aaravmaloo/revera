export default [
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**"]
  },
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module"
    },
    rules: {
      "no-unused-vars": "warn",
      "no-console": "off",
      "prefer-const": "error",
      "eqeqeq": "error"
    }
  }
];
