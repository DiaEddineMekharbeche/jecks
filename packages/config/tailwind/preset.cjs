/**
 * Jeck's design tokens — PRD Section 9.1 / 9.2.
 * Colors are emitted as CSS variables (see packages/ui/src/styles/tokens.css) so the
 * admin theme settings (F-AD-90) can override them at runtime without a rebuild.
 *
 * Contrast, verified: brass #D9B36A on base #0F0F10 = 9.68:1 (AAA).
 *                     brass #D9B36A on surface #1A1A1C = 8.98:1 (AAA).
 *                     ink #0F0F10 on brass #D9B36A = 9.68:1 (AAA) for filled buttons.
 */

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        base: 'rgb(var(--jk-base) / <alpha-value>)',
        // The same colour as `base`, under a name that is only ever a colour.
        //
        // `text-base` is Tailwind's font-size utility, so `bg-brass text-base` set the
        // size and left the text inheriting `ink` — near-white on gold at 1.77:1, on
        // every primary button in the shop and the admin. The tokens were right all
        // along; the utility name was the bug.
        'on-brass': 'rgb(var(--jk-base) / <alpha-value>)',
        surface: 'rgb(var(--jk-surface) / <alpha-value>)',
        elevated: 'rgb(var(--jk-elevated) / <alpha-value>)',
        line: 'rgb(var(--jk-line) / <alpha-value>)',
        ink: 'rgb(var(--jk-ink) / <alpha-value>)',
        muted: 'rgb(var(--jk-muted) / <alpha-value>)',
        brass: {
          DEFAULT: 'rgb(var(--jk-brass) / <alpha-value>)',
          soft: 'rgb(var(--jk-brass-soft) / <alpha-value>)',
          deep: 'rgb(var(--jk-brass-deep) / <alpha-value>)',
        },
        spark: 'rgb(var(--jk-spark) / <alpha-value>)',
        success: 'rgb(var(--jk-success) / <alpha-value>)',
        warning: 'rgb(var(--jk-warning) / <alpha-value>)',
        danger: 'rgb(var(--jk-danger) / <alpha-value>)',
        info: 'rgb(var(--jk-info) / <alpha-value>)',
      },
      fontFamily: {
        display: ['var(--jk-font-display)', 'Bebas Neue', 'Impact', 'sans-serif'],
        body: ['var(--jk-font-body)', 'Inter', 'system-ui', 'sans-serif'],
        arabic: ['var(--jk-font-arabic)', 'Cairo', 'Tahoma', 'sans-serif'],
        mono: ['var(--jk-font-mono)', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        display: ['clamp(3rem, 9vw, 7.5rem)', { lineHeight: '0.92', letterSpacing: '0.01em' }],
        hero: ['clamp(2.25rem, 5.5vw, 4.5rem)', { lineHeight: '0.98' }],
        eyebrow: ['0.6875rem', { lineHeight: '1', letterSpacing: '0.18em' }],
      },
      borderRadius: {
        xs: 'var(--jk-radius-xs)',
        sm: 'var(--jk-radius-sm)',
        DEFAULT: 'var(--jk-radius-md)',
        lg: 'var(--jk-radius-lg)',
        xl: 'var(--jk-radius-xl)',
      },
      boxShadow: {
        lift: '0 1px 2px rgb(0 0 0 / 0.14), 0 12px 32px -12px rgb(0 0 0 / 0.5)',
        card: '0 1px 3px rgb(0 0 0 / 0.1), 0 20px 48px -24px rgb(0 0 0 / 0.55)',
        glow: '0 0 0 1px rgb(var(--jk-brass) / 0.35), 0 18px 48px -20px rgb(var(--jk-brass) / 0.5)',
      },
      spacing: {
        gutter: 'var(--jk-gutter)',
        section: 'clamp(3.5rem, 8vw, 8rem)',
      },
      maxWidth: { shell: '90rem', prose: '68ch' },
      transitionTimingFunction: {
        brand: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      keyframes: {
        'fade-up': { from: { opacity: '0', transform: 'translateY(12px)' }, to: { opacity: '1', transform: 'none' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        'badge-pop': { '0%': { transform: 'scale(0.6)' }, '60%': { transform: 'scale(1.15)' }, '100%': { transform: 'scale(1)' } },
      },
      animation: {
        'fade-up': 'fade-up 0.5s cubic-bezier(0.22, 1, 0.36, 1) both',
        shimmer: 'shimmer 1.4s infinite',
        'badge-pop': 'badge-pop 0.32s cubic-bezier(0.22, 1, 0.36, 1)',
      },
    },
  },
  plugins: [],
};
