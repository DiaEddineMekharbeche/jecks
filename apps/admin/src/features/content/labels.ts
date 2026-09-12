/** The vocabulary the content screens render — PRD F-AD-90/91. */

export const SECTION_LABELS: Record<string, string> = {
  hero_3d: 'Héros',
  featured_collections: 'Collection mise en avant',
  new_arrivals: 'Nouveautés',
  best_sellers: 'Meilleures ventes',
  promo_countdown: 'Compte à rebours',
  promo_banner: 'Bannière promotionnelle',
  lookbook: 'Lookbook',
  brand_story: 'Histoire de la marque',
  testimonials: 'Avis clients',
  newsletter: 'Inscription newsletter',
};

/** What each block actually shows, so a name is never a guess. */
export const SECTION_HINTS: Record<string, string> = {
  hero_3d: 'La grande image en haut de page, avec le modèle 3D quand il y en a un.',
  featured_collections: 'Une collection choisie, avec ses premiers produits.',
  new_arrivals: 'Les derniers produits publiés.',
  best_sellers: 'Les produits les plus vendus, calculés sur les commandes livrées.',
  promo_countdown: 'Le temps restant sur une promotion qui a une date de fin.',
  promo_banner: 'Une image pleine largeur avec un titre et un bouton.',
  lookbook: 'Une image pleine largeur qui renvoie vers une collection.',
  brand_story: 'Un texte et une image sur la marque.',
  testimonials: 'Les meilleurs avis approuvés.',
  newsletter: 'Le formulaire d’inscription.',
};

export const PLACEMENT_LABELS: Record<string, string> = {
  home_hero: 'Accueil — haut',
  home_mid: 'Accueil — milieu',
  collection_top: 'Haut de collection',
  product_side: 'Fiche produit — côté',
  cart_upsell: 'Panier — suggestion',
};

export const PAGE_KIND_LABELS: Record<string, string> = {
  page: 'Page',
  post: 'Article',
  legal: 'Mentions légales',
};
