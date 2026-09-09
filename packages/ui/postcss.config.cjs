module.exports = {
  plugins: {
    // Storybook builds from this package root, so point Tailwind at the config that
    // includes the .storybook files as content.
    tailwindcss: { config: require.resolve('./tailwind.storybook.cjs') },
    autoprefixer: {},
  },
};
