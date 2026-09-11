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
  /** Stable key for realtime badge counters and saved views. */
  key: string;
  label: string;
  to: string;
  icon: ComponentType<{ className?: string }>;
  permission: Permission;
  status: 'ready' | 'planned';
  milestone?: string;
}

export const NAVIGATION: NavItem[] = [
  { key: "dashboard", label: 'Tableau de bord', to: '/', icon: LayoutDashboard, permission: 'reports.read', status: 'ready' },
  { key: "orders", label: 'Commandes', to: '/orders', icon: ShoppingCart, permission: 'orders.read', status: 'ready' },
  { key: "catalog", label: 'Catalogue', to: '/catalog/products', icon: Package, permission: 'catalog.read', status: 'ready' },
  { key: "inventory", label: 'Stock', to: '/inventory', icon: Boxes, permission: 'inventory.read', status: 'ready' },
  { key: "customers", label: 'Clients', to: '/customers', icon: Users, permission: 'customers.read', status: 'ready' },
  { key: "delivery", label: 'Livraison', to: '/delivery', icon: Truck, permission: 'delivery.read', status: 'ready' },
  { key: "promotions", label: 'Promotions', to: '/promotions', icon: Megaphone, permission: 'promotions.read', status: 'ready' },
  { key: "finance", label: 'Finances', to: '/finance', icon: Wallet, permission: 'finance.read', status: 'ready' },
  { key: "reports", label: 'Rapports', to: '/reports', icon: BarChart3, permission: 'reports.read', status: 'ready' },
  { key: "content", label: 'Contenu', to: '/content', icon: FileText, permission: 'content.read', status: 'planned', milestone: 'M6' },
  { key: "audit", label: 'Journal', to: '/audit', icon: ClipboardList, permission: 'audit.read', status: 'ready' },
  { key: "settings", label: 'Réglages', to: '/settings', icon: Settings, permission: 'settings.read', status: 'ready' },
];
