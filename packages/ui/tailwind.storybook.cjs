module.exports = {
  presets: [require('./tailwind.config.cjs')],
  content: ['./src/**/*.{ts,tsx}', './.storybook/**/*.{ts,tsx}'],
};
