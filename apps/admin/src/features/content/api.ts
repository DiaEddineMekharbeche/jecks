import type {
  AbandonedCartRow,
  AbandonedCartStats,
  AffiliateInput,
  AffiliateRow,
  AnnouncementDto,
  AnnouncementInput,
  BannerDto,
  BannerInput,
  ContactCartInput,
  HomeSectionDto,
  HomeSectionInput,
  MenuDto,
  MenuInput,
  MenuItemInput,
  NewsletterStats,
  NewsletterSubscriberRow,
  PageDetail,
  PageInput,
  PageRow,
  RedirectInput,
  RedirectRow,
  ReorderInput,
} from '@jecks/shared';
import { api } from '@/lib/api';

/** Every call the content and marketing screens make — PRD F-AD-90/91. */

// --- home -------------------------------------------------------------------

export const listHomeSections = () => api<HomeSectionDto[]>('/admin/content/home');

export const createHomeSection = (body: HomeSectionInput | Record<string, unknown>) =>
  api<HomeSectionDto>('/admin/content/home', { method: 'POST', body });

export const updateHomeSection = (id: string, body: HomeSectionInput | Record<string, unknown>) =>
  api<HomeSectionDto[]>(`/admin/content/home/${id}`, { method: 'PATCH', body });

export const reorderHomeSections = (body: ReorderInput | Record<string, unknown>) =>
  api<HomeSectionDto[]>('/admin/content/home/reorder', { method: 'POST', body });

export const deleteHomeSection = (id: string) =>
  api<void>(`/admin/content/home/${id}`, { method: 'DELETE' });

// --- banners ----------------------------------------------------------------

export const listBanners = () => api<BannerDto[]>('/admin/content/banners');

export const createBanner = (body: BannerInput | Record<string, unknown>) =>
  api<BannerDto[]>('/admin/content/banners', { method: 'POST', body });

export const updateBanner = (id: string, body: BannerInput | Record<string, unknown>) =>
  api<BannerDto[]>(`/admin/content/banners/${id}`, { method: 'PATCH', body });

export const deleteBanner = (id: string) =>
  api<void>(`/admin/content/banners/${id}`, { method: 'DELETE' });

// --- announcements ----------------------------------------------------------

export const listAnnouncements = () => api<AnnouncementDto[]>('/admin/content/announcements');

export const createAnnouncement = (body: AnnouncementInput | Record<string, unknown>) =>
  api<AnnouncementDto[]>('/admin/content/announcements', { method: 'POST', body });

export const updateAnnouncement = (id: string, body: AnnouncementInput | Record<string, unknown>) =>
  api<AnnouncementDto[]>(`/admin/content/announcements/${id}`, { method: 'PATCH', body });

export const deleteAnnouncement = (id: string) =>
  api<void>(`/admin/content/announcements/${id}`, { method: 'DELETE' });

// --- pages ------------------------------------------------------------------

export const listPages = (kind?: string) =>
  api<PageRow[]>('/admin/content/pages', { query: kind ? { kind } : {} });

export const getPage = (id: string) => api<PageDetail>(`/admin/content/pages/${id}`);

export const createPage = (body: PageInput | Record<string, unknown>) =>
  api<PageDetail>('/admin/content/pages', { method: 'POST', body });

export const updatePage = (id: string, body: PageInput | Record<string, unknown>) =>
  api<PageDetail>(`/admin/content/pages/${id}`, { method: 'PATCH', body });

export const deletePage = (id: string) =>
  api<void>(`/admin/content/pages/${id}`, { method: 'DELETE' });

// --- menus ------------------------------------------------------------------

export const listMenus = () => api<MenuDto[]>('/admin/content/menus');

export const createMenu = (body: MenuInput | Record<string, unknown>) =>
  api<MenuDto[]>('/admin/content/menus', { method: 'POST', body });

export const addMenuItem = (menuId: string, body: MenuItemInput | Record<string, unknown>) =>
  api<MenuDto[]>(`/admin/content/menus/${menuId}/items`, { method: 'POST', body });

export const updateMenuItem = (itemId: string, body: MenuItemInput | Record<string, unknown>) =>
  api<MenuDto[]>(`/admin/content/menus/items/${itemId}`, { method: 'PATCH', body });

export const deleteMenuItem = (itemId: string) =>
  api<MenuDto[]>(`/admin/content/menus/items/${itemId}`, { method: 'DELETE' });

export const deleteMenu = (id: string) =>
  api<void>(`/admin/content/menus/${id}`, { method: 'DELETE' });

// --- redirects --------------------------------------------------------------

export const listRedirects = () => api<RedirectRow[]>('/admin/content/redirects');

export const createRedirect = (body: RedirectInput | Record<string, unknown>) =>
  api<RedirectRow[]>('/admin/content/redirects', { method: 'POST', body });

export const deleteRedirect = (id: string) =>
  api<void>(`/admin/content/redirects/${id}`, { method: 'DELETE' });

// --- marketing --------------------------------------------------------------

export const listSubscribers = (limit = 500) =>
  api<NewsletterSubscriberRow[]>('/admin/marketing/newsletter', { query: { limit } });

export const newsletterStats = () =>
  api<NewsletterStats>('/admin/marketing/newsletter/stats');

export const newsletterProviders = () =>
  api<Array<{ key: string; label: string; requiredCredentials: string[] }>>(
    '/admin/marketing/newsletter/providers',
  );

export const syncNewsletter = (body: Record<string, unknown> = {}) =>
  api<{ provider: string; sent: number; skipped: number; warnings: string[] }>(
    '/admin/marketing/newsletter/sync',
    { method: 'POST', body },
  );

export const listAbandonedCarts = (filter: string) =>
  api<AbandonedCartRow[]>('/admin/marketing/abandoned-carts', { query: { filter } });

export const abandonedCartStats = () =>
  api<AbandonedCartStats>('/admin/marketing/abandoned-carts/stats');

export const contactCarts = (body: ContactCartInput | Record<string, unknown>) =>
  api<{ queued: number; skipped: number }>('/admin/marketing/abandoned-carts/contact', {
    method: 'POST',
    body,
  });

export const listAffiliates = () => api<AffiliateRow[]>('/admin/marketing/affiliates');

export const createAffiliate = (body: AffiliateInput | Record<string, unknown>) =>
  api<AffiliateRow[]>('/admin/marketing/affiliates', { method: 'POST', body });

export const updateAffiliate = (id: string, body: AffiliateInput | Record<string, unknown>) =>
  api<AffiliateRow[]>(`/admin/marketing/affiliates/${id}`, { method: 'PATCH', body });

export const deleteAffiliate = (id: string) =>
  api<void>(`/admin/marketing/affiliates/${id}`, { method: 'DELETE' });
