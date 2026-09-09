import { EmptyState } from '@jecks/ui';
import type { Permission } from '@jecks/shared';
import { Construction } from 'lucide-react';
import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { LoginPage } from '@/features/auth/LoginPage';
import { useSession } from '@/features/auth/session';
import { CatalogLayout } from '@/features/catalog/CatalogLayout';
import { CategoriesPage } from '@/features/catalog/CategoriesPage';
import { CollectionEditorPage } from '@/features/catalog/CollectionEditorPage';
import { CollectionsPage } from '@/features/catalog/CollectionsPage';
import { MerchandisingPage } from '@/features/catalog/MerchandisingPage';
import { ProductEditorPage } from '@/features/catalog/ProductEditorPage';
import { ProductsListPage } from '@/features/catalog/ProductsListPage';
import { ReviewsPage } from '@/features/catalog/ReviewsPage';
import {
  AttributesPage,
  BrandsPage,
  SizeGuidesPage,
  TagsPage,
} from '@/features/catalog/TaxonomyPages';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { MediaLibraryPage } from '@/features/media/MediaLibraryPage';
import { OrdersListPage } from '@/features/orders/OrdersListPage';
import { AppShell } from './AppShell';
import { NAVIGATION } from './navigation';

/** Blocks a route until the session is known, then by permission. */
function Protected({ permission, children }: { permission?: Permission; children: ReactNode }) {
  const status = useSession((state) => state.status);
  const can = useSession((state) => state.can);
  const location = useLocation();

  if (status === 'loading') return <BootSplash />;
  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (permission && !can(permission)) return <Forbidden />;
  return <>{children}</>;
}

export function AppRoutes() {
  const status = useSession((state) => state.status);

  return (
    <Routes>
      <Route
        path="/login"
        element={status === 'authenticated' ? <Navigate to="/" replace /> : <LoginPage />}
      />

      <Route
        element={
          <Protected>
            <AppShell />
          </Protected>
        }
      >
        <Route
          index
          element={
            <Protected permission="reports.read">
              <DashboardPage />
            </Protected>
          }
        />

        <Route
          path="/orders"
          element={
            <Protected permission="orders.read">
              <OrdersListPage />
            </Protected>
          }
        />

        {/* One layout, ten screens: the sub-navigation and the permission gate are
            declared once rather than repeated on every catalogue route. */}
        <Route
          path="/catalog"
          element={
            <Protected permission="catalog.read">
              <CatalogLayout />
            </Protected>
          }
        >
          <Route index element={<Navigate to="/catalog/products" replace />} />
          <Route path="products" element={<ProductsListPage />} />
          <Route path="products/:id" element={<ProductEditorPage />} />
          <Route path="categories" element={<CategoriesPage />} />
          <Route path="collections" element={<CollectionsPage />} />
          <Route path="collections/:id" element={<CollectionEditorPage />} />
          <Route path="brands" element={<BrandsPage />} />
          <Route path="tags" element={<TagsPage />} />
          <Route path="attributes" element={<AttributesPage />} />
          <Route path="size-guides" element={<SizeGuidesPage />} />
          <Route path="reviews" element={<ReviewsPage />} />
          <Route path="merchandising" element={<MerchandisingPage />} />
          <Route path="media" element={<MediaLibraryPage />} />
        </Route>

        {/* Modules whose screens arrive in later milestones still route, so the nav
            never dead-ends and the permission wiring is testable today. */}
        {NAVIGATION.filter((item) => item.status === 'planned').map((item) => (
          <Route
            key={item.to}
            path={item.to}
            element={
              <Protected permission={item.permission}>
                <PlannedModule label={item.label} milestone={item.milestone} />
              </Protected>
            }
          />
        ))}

        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

function BootSplash() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-base">
      <p className="font-display text-3xl tracking-[0.2em] text-brass">JECK&apos;S</p>
    </div>
  );
}

function Forbidden() {
  return (
    <EmptyState
      title="Accès refusé"
      description="Votre rôle ne donne pas accès à cette section. Demandez au propriétaire de vous l’ouvrir."
    />
  );
}

function NotFound() {
  return <EmptyState title="Page introuvable" description="Ce lien ne mène nulle part." />;
}

function PlannedModule({ label, milestone }: { label: string; milestone?: string }) {
  return (
    <EmptyState
      icon={<Construction className="h-8 w-8" />}
      title={`${label} arrive en ${milestone ?? 'v1'}`}
      description="Le module est planifié dans le PRD (section 5) et sera livré à ce jalon. Le contrôle d’accès est déjà en place."
    />
  );
}
