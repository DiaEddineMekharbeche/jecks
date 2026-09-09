import { DEFAULT_LOCALE, LOCALES, type Locale } from '@jecks/shared';

/**
 * UI copy. Product content is translated in the database (PRD Section 6.4); this file
 * holds only the chrome, so it stays small enough to ship in the RSC payload.
 *
 * Every value is a plain string. Counts and names go in as {placeholders} filled by
 * `fill()`, because a dictionary handed from a Server Component to a Client Component
 * has to be JSON-serializable, and a function is not.
 */

export const DICTIONARY = {
  fr: {
    nav: {
      shop: 'Boutique',
      collections: 'Collections',
      search: 'Rechercher',
      account: 'Compte',
      cart: 'Panier',
      wishlist: 'Favoris',
      menu: 'Menu',
      close: 'Fermer',
      skipToContent: 'Aller au contenu',
    },
    product: {
      new: 'Nouveau',
      soldOut: 'Épuisé',
      bestSeller: 'Best-seller',
      limited: 'Édition limitée',
      from: 'À partir de',
      colour: 'Coloris',
      size: 'Taille',
      sizeGuide: 'Guide des tailles',
      addToCart: 'Ajouter au panier',
      buyNow: 'Acheter maintenant',
      notifyMe: 'Prévenez-moi',
      onlyLeft: 'Plus que {count} en stock',
      inStock: 'En stock',
      outOfStock: 'Rupture de stock',
      details: 'Détails',
      description: 'Description',
      reviews: 'Avis',
      relatedTitle: 'Vous aimerez aussi',
      selectOptions: 'Choisissez vos options',
      sku: 'Référence',
    },
    delivery: {
      title: 'Livraison',
      chooseWilaya: 'Choisissez votre wilaya',
      home: 'À domicile',
      stopDesk: 'Point de retrait',
      free: 'Offerte',
      days: '{min} à {max} jours',
      daysOne: '{min} jour',
      cod: 'Paiement à la livraison',
      unavailable: 'Nous ne livrons pas encore dans cette wilaya',
    },
    listing: {
      filters: 'Filtres',
      sort: 'Trier',
      clear: 'Tout effacer',
      apply: 'Appliquer',
      results: '{count} articles',
      resultsOne: '1 article',
      empty: 'Aucun article ne correspond à ces filtres.',
      loadMore: 'Voir plus',
      price: 'Prix',
      availability: 'Disponibilité',
      onSale: 'En promotion',
      inStockOnly: 'En stock uniquement',
      sortOptions: {
        relevance: 'Pertinence',
        best_selling: 'Meilleures ventes',
        newest: 'Nouveautés',
        price_asc: 'Prix croissant',
        price_desc: 'Prix décroissant',
        discount: 'Meilleure remise',
      },
    },
    search: {
      placeholder: 'Chercher une casquette…',
      noResults: 'Rien trouvé pour « {query} ».',
      suggestions: 'Suggestions',
      products: 'Produits',
      collections: 'Collections',
    },
    footer: {
      newsletter: 'Recevez les nouveautés',
      newsletterHint: 'Un e-mail par mois, pas plus.',
      subscribe: 'S’inscrire',
      emailPlaceholder: 'Votre e-mail',
      rights: 'Tous droits réservés.',
      madeIn: 'Conçu à Alger',
    },
    common: {
      loading: 'Chargement…',
      error: 'Une erreur est survenue.',
      retry: 'Réessayer',
      back: 'Retour',
      home: 'Accueil',
    },
  },

  ar: {
    nav: {
      shop: 'المتجر',
      collections: 'المجموعات',
      search: 'بحث',
      account: 'حسابي',
      cart: 'السلة',
      wishlist: 'المفضلة',
      menu: 'القائمة',
      close: 'إغلاق',
      skipToContent: 'انتقل إلى المحتوى',
    },
    product: {
      new: 'جديد',
      soldOut: 'نفد',
      bestSeller: 'الأكثر مبيعا',
      limited: 'إصدار محدود',
      from: 'ابتداء من',
      colour: 'اللون',
      size: 'المقاس',
      sizeGuide: 'دليل المقاسات',
      addToCart: 'أضف إلى السلة',
      buyNow: 'اشتر الآن',
      notifyMe: 'أعلمني عند التوفر',
      onlyLeft: 'بقي {count} فقط',
      inStock: 'متوفر',
      outOfStock: 'غير متوفر',
      details: 'التفاصيل',
      description: 'الوصف',
      reviews: 'الآراء',
      relatedTitle: 'قد يعجبك أيضا',
      selectOptions: 'اختر الخيارات',
      sku: 'المرجع',
    },
    delivery: {
      title: 'التوصيل',
      chooseWilaya: 'اختر ولايتك',
      home: 'إلى المنزل',
      stopDesk: 'نقطة الاستلام',
      free: 'مجاني',
      days: 'من {min} إلى {max} أيام',
      daysOne: '{min} يوم',
      cod: 'الدفع عند الاستلام',
      unavailable: 'لا نوصل إلى هذه الولاية حاليا',
    },
    listing: {
      filters: 'تصفية',
      sort: 'ترتيب',
      clear: 'مسح الكل',
      apply: 'تطبيق',
      results: '{count} منتج',
      resultsOne: 'منتج واحد',
      empty: 'لا يوجد منتج يطابق هذه التصفية.',
      loadMore: 'عرض المزيد',
      price: 'السعر',
      availability: 'التوفر',
      onSale: 'في التخفيضات',
      inStockOnly: 'المتوفر فقط',
      sortOptions: {
        relevance: 'الأنسب',
        best_selling: 'الأكثر مبيعا',
        newest: 'الأحدث',
        price_asc: 'السعر تصاعديا',
        price_desc: 'السعر تنازليا',
        discount: 'أكبر تخفيض',
      },
    },
    search: {
      placeholder: 'ابحث عن قبعة…',
      noResults: 'لا نتائج لـ «{query}».',
      suggestions: 'اقتراحات',
      products: 'المنتجات',
      collections: 'المجموعات',
    },
    footer: {
      newsletter: 'اشترك في النشرة',
      newsletterHint: 'رسالة واحدة في الشهر، لا أكثر.',
      subscribe: 'اشتراك',
      emailPlaceholder: 'بريدك الإلكتروني',
      rights: 'كل الحقوق محفوظة.',
      madeIn: 'صُمم في الجزائر العاصمة',
    },
    common: {
      loading: 'جاري التحميل…',
      error: 'حدث خطأ.',
      retry: 'أعد المحاولة',
      back: 'رجوع',
      home: 'الرئيسية',
    },
  },

  en: {
    nav: {
      shop: 'Shop',
      collections: 'Collections',
      search: 'Search',
      account: 'Account',
      cart: 'Cart',
      wishlist: 'Wishlist',
      menu: 'Menu',
      close: 'Close',
      skipToContent: 'Skip to content',
    },
    product: {
      new: 'New',
      soldOut: 'Sold out',
      bestSeller: 'Best seller',
      limited: 'Limited edition',
      from: 'From',
      colour: 'Colour',
      size: 'Size',
      sizeGuide: 'Size guide',
      addToCart: 'Add to cart',
      buyNow: 'Buy now',
      notifyMe: 'Notify me',
      onlyLeft: 'Only {count} left',
      inStock: 'In stock',
      outOfStock: 'Out of stock',
      details: 'Details',
      description: 'Description',
      reviews: 'Reviews',
      relatedTitle: 'You may also like',
      selectOptions: 'Choose your options',
      sku: 'SKU',
    },
    delivery: {
      title: 'Delivery',
      chooseWilaya: 'Choose your wilaya',
      home: 'Home delivery',
      stopDesk: 'Pickup point',
      free: 'Free',
      days: '{min} to {max} days',
      daysOne: '{min} day',
      cod: 'Cash on delivery',
      unavailable: 'We do not deliver to that wilaya yet',
    },
    listing: {
      filters: 'Filters',
      sort: 'Sort',
      clear: 'Clear all',
      apply: 'Apply',
      results: '{count} items',
      resultsOne: '1 item',
      empty: 'Nothing matches those filters.',
      loadMore: 'Load more',
      price: 'Price',
      availability: 'Availability',
      onSale: 'On sale',
      inStockOnly: 'In stock only',
      sortOptions: {
        relevance: 'Relevance',
        best_selling: 'Best selling',
        newest: 'Newest',
        price_asc: 'Price, low to high',
        price_desc: 'Price, high to low',
        discount: 'Biggest discount',
      },
    },
    search: {
      placeholder: 'Search for a cap…',
      noResults: 'Nothing found for {query}.',
      suggestions: 'Suggestions',
      products: 'Products',
      collections: 'Collections',
    },
    footer: {
      newsletter: 'Get the drops first',
      newsletterHint: 'One e-mail a month, no more.',
      subscribe: 'Subscribe',
      emailPlaceholder: 'Your e-mail',
      rights: 'All rights reserved.',
      madeIn: 'Designed in Algiers',
    },
    common: {
      loading: 'Loading…',
      error: 'Something went wrong.',
      retry: 'Try again',
      back: 'Back',
      home: 'Home',
    },
  },
} as const;

export type Dictionary = (typeof DICTIONARY)['fr'];

export function getDictionary(locale: Locale): Dictionary {
  return (DICTIONARY[locale] ?? DICTIONARY[DEFAULT_LOCALE]) as Dictionary;
}

export function isSupportedLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/** Fills {placeholders} in a dictionary string: fill(d.product.onlyLeft, { count: 3 }). */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

/** Picks the singular variant when there is exactly one, then fills it. */
export function fillCount(
  plural: string,
  singular: string,
  count: number,
  key = 'count',
): string {
  return fill(count === 1 ? singular : plural, { [key]: count });
}

/** Delivery window, collapsing '2 to 2 days' into '2 days'. */
export function formatEta(dictionary: Dictionary, min: number, max: number): string {
  return min === max
    ? fill(dictionary.delivery.daysOne, { min })
    : fill(dictionary.delivery.days, { min, max });
}
