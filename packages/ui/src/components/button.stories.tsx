import type { Meta, StoryObj } from '@storybook/react';
import { ShoppingBag } from 'lucide-react';
import { Button } from './button';

const meta = {
  title: 'Primitives/Button',
  component: Button,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['primary', 'secondary', 'outline', 'ghost', 'danger', 'link'],
    },
    size: { control: 'select', options: ['sm', 'md', 'lg', 'icon'] },
    editorial: { control: 'boolean' },
    loading: { control: 'boolean' },
  },
  args: { children: 'Ajouter au panier' },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {};

export const Editorial: Story = {
  args: { editorial: true, size: 'lg', children: 'Voir la collection' },
  parameters: {
    docs: {
      description: {
        story:
          'Storefront call to action: condensed display face, wide tracking, upper case.',
      },
    },
  },
};

export const Variants: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-3">
      <Button {...args} variant="primary">
        Primary
      </Button>
      <Button {...args} variant="secondary">
        Secondary
      </Button>
      <Button {...args} variant="outline">
        Outline
      </Button>
      <Button {...args} variant="ghost">
        Ghost
      </Button>
      <Button {...args} variant="danger">
        Supprimer
      </Button>
      <Button {...args} variant="link">
        Lien
      </Button>
    </div>
  ),
};

export const Sizes: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-3">
      <Button {...args} size="sm">
        Small
      </Button>
      <Button {...args} size="md">
        Medium
      </Button>
      <Button {...args} size="lg">
        Large
      </Button>
      <Button {...args} size="icon" aria-label="Panier">
        <ShoppingBag className="h-4 w-4" />
      </Button>
    </div>
  ),
};

export const Loading: Story = {
  args: { loading: true },
  parameters: {
    docs: {
      description: {
        story:
          'Loading disables the button and sets `aria-busy`, so a screen reader hears that the action is running rather than only seeing a spinner.',
      },
    },
  },
};

export const Disabled: Story = {
  args: { disabled: true, children: 'Rupture de stock' },
};
