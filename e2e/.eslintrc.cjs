module.exports = {
  extends: [require.resolve('@jecks/config/eslint/base.cjs')],
  rules: {
    // Playwright's fixtures are destructured whether or not every one is used, and a
    // spec that takes `page` only to scope a request is normal rather than a mistake.
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_|^page$' }],
  },
};
