module.exports = {
  root: true,
  extends: [require.resolve('@quantumed/config-eslint/nextjs.js')],
  parserOptions: {
    project: false,
  },
  ignorePatterns: ['.next', 'dist', 'node_modules'],
};
