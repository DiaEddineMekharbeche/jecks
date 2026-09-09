import { withThemeByDataAttribute } from '@storybook/addon-themes';
import type { Preview } from '@storybook/react';
import './preview.css';

/**
 * Every story renders against the real tokens. The toolbar switches the two surfaces
 * the design system supports: the dark storefront and the light admin.
 */
const preview: Preview = {
  parameters: {
    layout: 'centered',
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    backgrounds: { disable: true },
    a11y: { config: { rules: [{ id: 'color-contrast', enabled: true }] } },
  },
  decorators: [
    withThemeByDataAttribute({
      themes: { storefront: '', admin: 'admin' },
      defaultTheme: 'storefront',
      attributeName: 'data-surface',
    }),
  ],
};

export default preview;
