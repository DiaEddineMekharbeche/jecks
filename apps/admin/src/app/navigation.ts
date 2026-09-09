import type { Permission } from '@jecks/shared';
import {
  BarChart3,
  Boxes,
  ClipboardList,
  FileText,
  LayoutDashboard,
  Megaphone,
  Package,
  Settings,
  ShoppingCart,
  Truck,
  Users,
  Wallet,
} from 'lucide-react';
import type { ComponentType } from 'react';

/**
 * Left navigation — one entry per module of PRD Section 5, in the same order.
 * `permission` drives both the menu and the route guard, so a hidden section is also
 * an unreachable URL (acceptance criterion 6).
 *
 * `status: 'planned'` marks modules whose screens land in a later milestone; they are
 * shown greyed so the owner can see the shape of the finished back-office.
 */
export interface NavItem {
  label: string;
  to: string;
  icon: ComponentType<{ className?: string }>;
  permission: Permission;
  status: 'ready' | 'planned';
  milestone?: string;
}

export const NAVIGATION: NavItem[] = [
  { label: 'Tableau de bord', to: '/', icon: LayoutDashboard, permission: 'reports.read', status: 'ready' },
  { label: 'Commandes', to: '/orders', icon: ShoppingCart, permission: 'orders.read', status: 'planned', milestone: 'M3' },
  { label: 'Catalogue', to: '/catalog', icon: Package, permission: 'catalog.read', status: 'planned', milestone: 'M1' },
  { label: 'Stock', to: '/inventory', icon: Boxes, permission: 'inventory.read', status: 'planned', milestone: 'M1' },
  { label: 'Clients', to: '/customers', icon: Users, permission: 'customers.read', status: 'planned', milestone: 'M5' },
  { label: 'Livraison', to: '/delivery', icon: Truck, permission: 'delivery.read', status: 'planned', milestone: 'M4' },
  { label: 'Promotions', to: '/promotions', icon: Megaphone, permission: 'promotions.read', status: 'planned', milestone: 'M3' },
  { label: 'Finances', to: '/finance', icon: Wallet, permission: 'finance.read', status: 'planned', milestone: 'M5' },
  { label: 'Rapports', to: '/reports', icon: BarChart3, permission: 'reports.read', status: 'planned', milestone: 'M5' },
  { label: 'Contenu', to: '/content', icon: FileText, permission: 'content.read', status: 'planned', milestone: 'M6' },
  { label: 'Journal', to: '/audit', icon: ClipboardList, permission: 'audit.read', status: 'planned', milestone: 'M1' },
  { label: 'Réglages', to: '/settings', icon: Settings, permission: 'settings.read', status: 'planned', milestone: 'M1' },
];
