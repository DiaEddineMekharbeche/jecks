import { EmptyState } from '@jecks/ui';
import type { Permission } from '@jecks/shared';
import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuditPage } from '@/features/audit/AuditPage';
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
import { AnnouncementsPage } from '@/features/content/AnnouncementsPage';
import { BannersPage } from '@/features/content/BannersPage';
import { ContentLayout } from '@/features/content/ContentLayout';
import { HomeBuilderPage } from '@/features/content/HomeBuilderPage';
import {
  AbandonedCartsPage,
  AffiliatesPage,
  NewsletterPage,
} from '@/features/content/MarketingPages';
import { MenusPage } from '@/features/content/MenusPage';
import { PagesPage } from '@/features/content/PagesPage';
import { RedirectsPage } from '@/features/content/RedirectsPage';
import { CustomerDetailPage } from '@/features/customers/CustomerDetailPage';
import { CustomersListPage } from '@/features/customers/CustomersListPage';
import { CashPage } from '@/features/delivery/CashPage';
import { CouriersPage } from '@/features/delivery/CouriersPage';
import { DeliveryAnalyticsPage } from '@/features/delivery/DeliveryAnalyticsPage';
import { DeliveryLayout } from '@/features/delivery/DeliveryLayout';
import { DriverPage } from '@/features/delivery/DriverPage';
import { FleetPage } from '@/features/delivery/FleetPage';
import { RatesPage } from '@/features/delivery/RatesPage';
import { RunDetailPage } from '@/features/delivery/RunDetailPage';
import { RunsPage } from '@/features/delivery/RunsPage';
import { SettlementsPage } from '@/features/delivery/SettlementsPage';
import { ShipmentsPage } from '@/features/delivery/ShipmentsPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { AdSpendPage } from '@/features/finance/AdSpendPage';
import { ExpensesPage } from '@/features/finance/ExpensesPage';
import { FinanceLayout } from '@/features/finance/FinanceLayout';
import { LedgerPage } from '@/features/finance/LedgerPage';
import { PnlPage } from '@/features/finance/PnlPage';
import { ReportsPage } from '@/features/finance/ReportsPage';
import { InventoryLayout } from '@/features/inventory/InventoryLayout';
import { LocationsPage } from '@/features/inventory/LocationsPage';
import { MovementsPage } from '@/features/inventory/MovementsPage';
import { PurchaseOrderEditorPage } from '@/features/inventory/PurchaseOrderEditorPage';
import { PurchaseOrdersPage } from '@/features/inventory/PurchaseOrdersPage';
import { StockCountSessionPage } from '@/features/inventory/StockCountSessionPage';
import { StockCountsPage } from '@/features/inventory/StockCountsPage';
import { StockOverviewPage } from '@/features/inventory/StockOverviewPage';
import { SuppliersPage } from '@/features/inventory/SuppliersPage';
import { MediaLibraryPage } from '@/features/media/MediaLibraryPage';
import { AcceptInvitationPage } from '@/features/settings/AcceptInvitationPage';
import { BackupsPage } from '@/features/settings/BackupsPage';
import { NotificationTemplatesPage } from '@/features/settings/NotificationTemplatesPage';
import { RolesPage } from '@/features/settings/RolesPage';
import { SettingsLayout } from '@/features/settings/SettingsLayout';
import { SettingsScopePage } from '@/features/settings/SettingsScopePage';
import { UsersPage } from '@/features/settings/UsersPage';
import { OrderDetailPage } from '@/features/orders/OrderDetailPage';
import { OrdersListPage } from '@/features/orders/OrdersListPage';
import { PromotionEditorPage } from '@/features/promotions/PromotionEditorPage';
import { PromotionsListPage } from '@/features/promotions/PromotionsListPage';
import { SimulatorPage } from '@/features/promotions/SimulatorPage';
import { AppShell } from './AppShell';

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
      {/* Reachable with no session: the invitee has no account until they land here. */}
      <Route path="/invitation" element={<AcceptInvitationPage />} />

      <Route
        path="/login"
        element={status === 'authenticated' ? <Navigate to="/" replace /> : <LoginPage />}
      />

      <Route
        path="/driver"
        element={
          <Protected permission="delivery.own_runs">
            <DriverPage />
          </Protected>
        }
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

        <Route
          path="/orders/:id"
          element={
            <Protected permission="orders.read">
              <OrderDetailPage />
            </Protected>
          }
        />

        {/* Promotions — PRD F-AD-20/21. The simulator is declared before `:id` so
            "simulator" is never read as a promotion id. */}
        <Route
          path="/promotions"
          element={
            <Protected permission="promotions.read">
              <PromotionsListPage />
            </Protected>
          }
        />

        <Route
          path="/promotions/simulator"
          element={
            <Protected permission="promotions.read">
              <SimulatorPage />
            </Protected>
          }
        />

        <Route
          path="/promotions/:id"
          element={
            <Protected permission="promotions.read">
              <PromotionEditorPage />
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

        {/* Content and marketing — PRD F-AD-90/91. */}
        <Route
          path="/content"
          element={
            <Protected permission="content.read">
              <ContentLayout />
            </Protected>
          }
        >
          <Route index element={<HomeBuilderPage />} />
          <Route path="banners" element={<BannersPage />} />
          <Route path="announcements" element={<AnnouncementsPage />} />
          <Route path="pages" element={<PagesPage />} />
          <Route path="menus" element={<MenusPage />} />
          <Route path="newsletter" element={<NewsletterPage />} />
          <Route path="carts" element={<AbandonedCartsPage />} />
          <Route path="affiliates" element={<AffiliatesPage />} />
          <Route path="redirects" element={<RedirectsPage />} />
        </Route>

        {/* Customers — PRD F-AD-40 to F-AD-42. */}
        <Route
          path="/customers"
          element={
            <Protected permission="customers.read">
              <CustomersListPage />
            </Protected>
          }
        />

        <Route
          path="/customers/:id"
          element={
            <Protected permission="customers.read">
              <CustomerDetailPage />
            </Protected>
          }
        />

        {/* Finance — PRD F-AD-70 to F-AD-73. */}
        <Route
          path="/finance"
          element={
            <Protected permission="finance.read">
              <FinanceLayout />
            </Protected>
          }
        >
          <Route index element={<PnlPage />} />
          <Route path="expenses" element={<ExpensesPage />} />
          <Route path="ad-spend" element={<AdSpendPage />} />
          <Route path="ledger" element={<LedgerPage />} />
        </Route>

        {/* The report library — PRD F-AD-80/81. Separate from finance because a
            marketing role reads reports without seeing the cash. */}
        <Route
          path="/reports"
          element={
            <Protected permission="reports.read">
              <ReportsPage />
            </Protected>
          }
        />

        {/* Delivery — PRD F-AD-60 to F-AD-65. Cash and settlements are gated again
            inside the layout, so a dispatcher never sees the drawer. */}
        <Route
          path="/delivery"
          element={
            <Protected permission="delivery.read">
              <DeliveryLayout />
            </Protected>
          }
        >
          <Route index element={<ShipmentsPage />} />
          <Route path="runs" element={<RunsPage />} />
          <Route path="runs/:id" element={<RunDetailPage />} />
          <Route path="couriers" element={<CouriersPage />} />
          <Route path="rates" element={<RatesPage />} />
          <Route path="fleet" element={<FleetPage />} />
          <Route
            path="cash"
            element={
              <Protected permission="delivery.settle">
                <CashPage />
              </Protected>
            }
          />
          <Route
            path="settlements"
            element={
              <Protected permission="delivery.settle">
                <SettlementsPage />
              </Protected>
            }
          />
          <Route path="analytics" element={<DeliveryAnalyticsPage />} />
        </Route>

        {/* Stock — PRD F-AD-50 to F-AD-53. Purchasing sits behind its own permission
            so a warehouse hand can count stock without seeing supplier pricing. */}
        <Route
          path="/inventory"
          element={
            <Protected permission="inventory.read">
              <InventoryLayout />
            </Protected>
          }
        >
          <Route index element={<StockOverviewPage />} />
          <Route path="movements" element={<MovementsPage />} />
          <Route path="counts" element={<StockCountsPage />} />
          <Route path="counts/:id" element={<StockCountSessionPage />} />
          <Route path="locations" element={<LocationsPage />} />
          <Route
            path="suppliers"
            element={
              <Protected permission="purchasing.read">
                <SuppliersPage />
              </Protected>
            }
          />
          <Route
            path="purchase-orders"
            element={
              <Protected permission="purchasing.read">
                <PurchaseOrdersPage />
              </Protected>
            }
          />
          <Route
            path="purchase-orders/:id"
            element={
              <Protected permission="purchasing.read">
                <PurchaseOrderEditorPage />
              </Protected>
            }
          />
        </Route>

        {/* The journal — PRD F-AD-93. Read-only; the interceptor is what writes it. */}
        <Route
          path="/audit"
          element={
            <Protected permission="audit.read">
              <AuditPage />
            </Protected>
          }
        />

        {/* Settings — PRD F-AD-91 and F-AD-92. Team and roles carry their own
            permission, so a manager sees the shop settings but not the accounts. */}
        <Route
          path="/settings"
          element={
            <Protected permission="settings.read">
              <SettingsLayout />
            </Protected>
          }
        >
          <Route index element={<Navigate to="/settings/store" replace />} />
          <Route path="templates" element={<NotificationTemplatesPage />} />
          <Route path="backups" element={<BackupsPage />} />
          <Route
            path="users"
            element={
              <Protected permission="users.read">
                <UsersPage />
              </Protected>
            }
          />
          <Route
            path="roles"
            element={
              <Protected permission="users.read">
                <RolesPage />
              </Protected>
            }
          />
          {/* Everything else is a generated scope form. */}
          <Route path=":scope" element={<SettingsScopePage />} />
        </Route>

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
