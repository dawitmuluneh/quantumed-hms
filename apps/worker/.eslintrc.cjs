module.exports = {
  root: true,
  extends: [require.resolve('@quantumed/config-eslint/node.js')],
  parserOptions: {
    project: './tsconfig.json',
    tsconfigRootDir: __dirname,
  },
};
