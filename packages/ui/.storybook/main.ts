import type { StorybookConfig } from '@storybook/react-vite';

/** Storybook for the Jeck's design system — PRD Section 9.2 and milestone M0. */
const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: [
    '@storybook/addon-essentials',
    // Contrast and label checks run in the panel, so a component cannot regress
    // the WCAG 2.1 AA requirement of PRD Section 6.6 unnoticed.
    '@storybook/addon-a11y',
    '@storybook/addon-themes',
  ],
  framework: { name: '@storybook/react-vite', options: {} },
  typescript: { reactDocgen: 'react-docgen-typescript' },
  docs: { autodocs: 'tag' },
};

export default config;
