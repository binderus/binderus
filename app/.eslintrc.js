module.exports = {
  parser: '@typescript-eslint/parser',
  plugins: ['react', '@typescript-eslint'], // 'node'
  extends: ['prettier', 'eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: {
    browser: true,
    node: true
  },
  rules: {
    // '@typescript-eslint/no-unused-vars': 'error',
    // '@typescript-eslint/no-explicit-any': 'error'
  },
  ignorePatterns: []
};
