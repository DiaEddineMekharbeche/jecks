import type { Meta, StoryObj } from '@storybook/react';

/**
 * A visual index of the design tokens, so a contributor can see what exists before
 * inventing a new value. Switch the surface in the toolbar to check both palettes.
 */
const meta = {
  title: 'Foundations/Tokens',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const COLORS = [
  { token: 'base', note: 'Page ground' },
  { token: 'surface', note: 'Cards, header' },
  { token: 'elevated', note: 'Hover, skeletons' },
  { token: 'line', note: 'Borders, dividers' },
  { token: 'ink', note: 'Body text' },
  { token: 'muted', note: 'Secondary text' },
  { token: 'brass', note: 'Accent, 9.68:1 on base' },
  { token: 'brass-soft', note: 'Accent hover' },
  { token: 'brass-deep', note: 'Accent pressed' },
  { token: 'spark', note: 'Secondary accent' },
  { token: 'success', note: 'Delivered, in stock' },
  { token: 'warning', note: 'Low stock, attention' },
  { token: 'danger', note: 'Failed, destructive' },
  { token: 'info', note: 'Neutral notice' },
];

export const Colours: Story = {
  render: () => (
    <div className="p-8">
      <h2 className="font-display text-3xl">Colours</h2>
      <p className="mt-2 max-w-prose text-sm text-muted">
        Defined once in <code>tokens.css</code> as RGB triples, which is what lets
        Tailwind apply opacity (<code>bg-brass/20</code>) and lets the admin theme editor
        override them at runtime.
      </p>
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {COLORS.map((entry) => (
          <div key={entry.token} className="flex items-center gap-3 rounded-sm border border-line p-3">
            <div
              className="h-12 w-12 shrink-0 rounded-sm border border-line"
              style={{ backgroundColor: `rgb(var(--jk-${entry.token}))` }}
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{entry.token}</p>
              <p className="truncate text-xs text-muted">{entry.note}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  ),
};

export const Typography: Story = {
  render: () => (
    <div className="flex flex-col gap-6 p-8">
      <div>
        <p className="eyebrow">Display · Bebas Neue</p>
        <p className="font-display text-display">Casquettes</p>
      </div>
      <div>
        <p className="eyebrow">Hero</p>
        <p className="font-display text-hero">Une casquette qui vieillit bien</p>
      </div>
      <div>
        <p className="eyebrow">Body · Inter</p>
        <p className="max-w-prose">
          Façade coton brossé, maille aérée à l’arrière et patch brodé main. La Trucker
          Atlas garde sa forme après une saison entière.
        </p>
      </div>
      <div dir="rtl">
        <p className="eyebrow">Arabic · Cairo</p>
        <p className="font-arabic max-w-prose text-lg">
          قبعات مصممة في الجزائر العاصمة، سلاسل قصيرة، الدفع عند الاستلام في 58 ولاية.
        </p>
      </div>
    </div>
  ),
};

export const Radii: Story = {
  render: () => (
    <div className="flex flex-wrap items-end gap-4 p-8">
      {(['xs', 'sm', 'DEFAULT', 'lg', 'xl'] as const).map((size) => (
        <div key={size} className="text-center">
          <div
            className="h-20 w-20 border border-line bg-surface"
            style={{
              borderRadius: `var(--jk-radius-${size === 'DEFAULT' ? 'md' : size})`,
            }}
          />
          <p className="mt-2 text-xs text-muted">{size}</p>
        </div>
      ))}
    </div>
  ),
};
