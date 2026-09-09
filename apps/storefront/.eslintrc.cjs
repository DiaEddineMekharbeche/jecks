module.exports = {
  extends: [require.resolve('@jecks/config/eslint/react.cjs')],
  overrides: [
    {
      // React Three Fiber renders three.js objects as intrinsic elements (`<mesh>`,
      // `<meshStandardMaterial>`…). Their props are three.js constructor arguments,
      // which the React DOM property list cannot know about.
      files: ['src/components/hero-canvas.tsx', 'src/components/three/**/*.tsx'],
      rules: { 'react/no-unknown-property': 'off' },
    },
  ],
};
