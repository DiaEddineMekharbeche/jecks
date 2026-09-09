/** Consumers extend this: `presets: [require('@jecks/ui/tailwind')]`. */
module.exports = {
  presets: [require('@jecks/config/tailwind/preset.cjs')],
  content: [
    './src/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
};
