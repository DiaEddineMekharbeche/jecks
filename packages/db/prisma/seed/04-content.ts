import type { PrismaClient } from '@prisma/client';
import { log, tr } from './util.js';

/** Storefront chrome and CMS — PRD F-ST-02 to F-ST-04, F-ST-60, F-AD-22, F-AD-23. */
export async function seedContent(prisma: PrismaClient): Promise<void> {
  // --- header mega-menu ------------------------------------------------------
  const header = await prisma.menu.upsert({
    where: { slug: 'header' },
    create: { slug: 'header', name: tr('Menu principal', 'القائمة الرئيسية', 'Main menu') },
    update: {},
  });

  await prisma.menuItem.deleteMany({ where: { menuId: header.id } });

  const capsParent = await prisma.menuItem.create({
    data: { menuId: header.id, label: tr('Casquettes', 'قبعات', 'Caps'), url: '/collections/casquettes', position: 0 },
  });

  const capsChildren = [
    { fr: 'Nouveautés', ar: 'الجديد', en: 'New', url: '/collections/nouveautes' },
    { fr: 'Truckers', ar: 'تراكر', en: 'Truckers', url: '/categories/trucker' },
    { fr: 'Snapbacks', ar: 'سناباك', en: 'Snapbacks', url: '/categories/snapback' },
    { fr: 'Fitted', ar: 'فيتد', en: 'Fitted', url: '/categories/fitted' },
    { fr: 'Dad caps', ar: 'داد كاب', en: 'Dad caps', url: '/categories/dad-cap' },
    { fr: '5-panel', ar: 'خمس لوحات', en: '5-panel', url: '/categories/five-panel' },
    { fr: 'Bobs', ar: 'قبعات دلو', en: 'Bucket hats', url: '/categories/bucket' },
    { fr: 'Bonnets', ar: 'بيني', en: 'Beanies', url: '/categories/beanie' },
    { fr: 'Enfants', ar: 'أطفال', en: 'Kids', url: '/categories/enfants' },
    { fr: 'Femmes', ar: 'نساء', en: 'Women', url: '/categories/femmes' },
  ];
  for (const [index, child] of capsChildren.entries()) {
    await prisma.menuItem.create({
      data: {
        menuId: header.id,
        parentId: capsParent.id,
        label: tr(child.fr, child.ar, child.en),
        url: child.url,
        position: index,
      },
    });
  }

  const topLevel = [
    { fr: 'Collections', ar: 'المجموعات', en: 'Collections', url: '/collections' },
    { fr: 'Dernière chance', ar: 'الفرصة الأخيرة', en: 'Last chance', url: '/collections/derniere-chance' },
    { fr: 'À propos', ar: 'من نحن', en: 'About', url: '/pages/a-propos' },
  ];
  for (const [index, item] of topLevel.entries()) {
    await prisma.menuItem.create({
      data: { menuId: header.id, label: tr(item.fr, item.ar, item.en), url: item.url, position: index + 1 },
    });
  }

  // --- footer ---------------------------------------------------------------
  const footer = await prisma.menu.upsert({
    where: { slug: 'footer' },
    create: { slug: 'footer', name: tr('Pied de page', 'تذييل الصفحة', 'Footer') },
    update: {},
  });
  await prisma.menuItem.deleteMany({ where: { menuId: footer.id } });

  const footerGroups: Array<{ label: [string, string, string]; children: Array<{ label: [string, string, string]; url: string }> }> = [
    {
      label: ['Aide', 'المساعدة', 'Help'],
      children: [
        { label: ['Livraison & retours', 'الشحن والإرجاع', 'Shipping & returns'], url: '/pages/livraison-retours' },
        { label: ['FAQ', 'الأسئلة الشائعة', 'FAQ'], url: '/pages/faq' },
        { label: ['Guide des tailles', 'دليل المقاسات', 'Size guide'], url: '/pages/guide-des-tailles' },
        { label: ['Contact', 'اتصل بنا', 'Contact'], url: '/pages/contact' },
        { label: ['Suivre ma commande', 'تتبع طلبي', 'Track my order'], url: '/track' },
      ],
    },
    {
      label: ['Maison', 'الدار', 'House'],
      children: [
        { label: ['À propos', 'من نحن', 'About'], url: '/pages/a-propos' },
        { label: ['Nos matières', 'موادنا', 'Our materials'], url: '/pages/nos-matieres' },
        { label: ['Points de vente', 'نقاط البيع', 'Stockists'], url: '/pages/points-de-vente' },
      ],
    },
    {
      label: ['Légal', 'قانوني', 'Legal'],
      children: [
        { label: ['Conditions générales', 'الشروط العامة', 'Terms'], url: '/pages/conditions-generales' },
        { label: ['Confidentialité', 'الخصوصية', 'Privacy'], url: '/pages/confidentialite' },
      ],
    },
  ];

  for (const [groupIndex, group] of footerGroups.entries()) {
    const parent = await prisma.menuItem.create({
      data: {
        menuId: footer.id,
        label: tr(group.label[0], group.label[1], group.label[2]),
        url: '#',
        position: groupIndex,
      },
    });
    for (const [index, child] of group.children.entries()) {
      await prisma.menuItem.create({
        data: {
          menuId: footer.id,
          parentId: parent.id,
          label: tr(child.label[0], child.label[1], child.label[2]),
          url: child.url,
          position: index,
        },
      });
    }
  }
  log('menus', 2);

  // --- CMS pages ------------------------------------------------------------
  const pages = [
    {
      slug: 'a-propos',
      kind: 'page',
      title: ['À propos de Jeck’s', 'عن جيكس', 'About Jeck’s'] as const,
      body: [
        '<p>Jeck’s est née à Alger d’une idée simple : une casquette doit vieillir bien. Nous dessinons chaque coupe, choisissons les toiles, et gardons les séries courtes.</p><p>Chaque modèle passe par un prototype porté pendant un mois avant d’être produit.</p>',
        '<p>ولدت جيكس في الجزائر العاصمة من فكرة بسيطة: القبعة يجب أن تتقادم بشكل جميل. نصمم كل قصة، ونختار الأقمشة، ونحافظ على سلاسل قصيرة.</p>',
        '<p>Jeck’s was born in Algiers from a simple idea: a cap should age well. We draw every cut, choose the fabrics, and keep the runs short.</p>',
      ] as const,
    },
    {
      slug: 'livraison-retours',
      kind: 'legal',
      title: ['Livraison & retours', 'الشحن والإرجاع', 'Shipping & returns'] as const,
      body: [
        '<p>Livraison à domicile ou en stop-desk dans les 58 wilayas. Paiement à la livraison. Comptez 1 à 2 jours dans le Centre, 2 à 4 jours ailleurs, jusqu’à 7 jours dans le Grand Sud.</p><p>Livraison offerte à partir de 6 000 DA. Retour accepté sous 7 jours, article non porté, étiquette en place.</p>',
        '<p>التوصيل إلى المنزل أو إلى مكتب الاستلام في 58 ولاية. الدفع عند الاستلام. من يوم إلى يومين في الوسط، ومن يومين إلى أربعة أيام في باقي الولايات.</p>',
        '<p>Home or stop-desk delivery across all 58 wilayas. Cash on delivery. Free over 6 000 DA. Returns within 7 days, unworn, tags on.</p>',
      ] as const,
    },
    {
      slug: 'faq',
      kind: 'page',
      title: ['Questions fréquentes', 'الأسئلة الشائعة', 'FAQ'] as const,
      body: [
        '<h3>Puis-je payer à la livraison ?</h3><p>Oui, c’est le mode par défaut partout en Algérie.</p><h3>Comment choisir ma taille ?</h3><p>Mesurez votre tour de tête au-dessus des oreilles et comparez au guide des tailles.</p><h3>Livrez-vous dans le Sud ?</h3><p>Oui, dans les 58 wilayas, avec un délai plus long.</p>',
        '<h3>هل يمكنني الدفع عند الاستلام؟</h3><p>نعم، هذا هو الخيار الافتراضي في كامل التراب الوطني.</p>',
        '<h3>Can I pay on delivery?</h3><p>Yes, it is the default everywhere in Algeria.</p>',
      ] as const,
    },
    {
      slug: 'guide-des-tailles',
      kind: 'page',
      title: ['Guide des tailles', 'دليل المقاسات', 'Size guide'] as const,
      body: [
        '<p>Passez un mètre ruban autour de la tête, juste au-dessus des oreilles et des sourcils.</p><table><tr><th>Taille</th><th>Tour de tête</th></tr><tr><td>S</td><td>54-56 cm</td></tr><tr><td>M</td><td>56-58 cm</td></tr><tr><td>L</td><td>58-60 cm</td></tr></table>',
        '<p>قس محيط رأسك فوق الأذنين مباشرة.</p>',
        '<p>Run a tape around your head, just above the ears and eyebrows.</p>',
      ] as const,
    },
    {
      slug: 'contact',
      kind: 'page',
      title: ['Contact', 'اتصل بنا', 'Contact'] as const,
      body: [
        '<p>Écrivez-nous à contact@jecks.dz ou appelez le 0551 00 00 00, du dimanche au jeudi, 9h-17h.</p>',
        '<p>راسلنا على contact@jecks.dz أو اتصل على 0551 00 00 00.</p>',
        '<p>Write to contact@jecks.dz or call 0551 00 00 00, Sunday to Thursday, 9am-5pm.</p>',
      ] as const,
    },
    {
      slug: 'conditions-generales',
      kind: 'legal',
      title: ['Conditions générales de vente', 'الشروط العامة للبيع', 'Terms of sale'] as const,
      body: ['<p>Conditions générales de vente applicables aux commandes passées sur jecks.dz.</p>', '<p>الشروط العامة للبيع.</p>', '<p>Terms of sale for orders placed on jecks.dz.</p>'] as const,
    },
    {
      slug: 'confidentialite',
      kind: 'legal',
      title: ['Politique de confidentialité', 'سياسة الخصوصية', 'Privacy policy'] as const,
      body: [
        '<p>Nous conservons votre nom, votre téléphone et votre adresse pour livrer vos commandes. Vous pouvez demander leur suppression à tout moment.</p>',
        '<p>نحتفظ باسمك ورقم هاتفك وعنوانك من أجل تسليم طلباتك.</p>',
        '<p>We keep your name, phone and address to deliver your orders. You can ask us to delete them at any time.</p>',
      ] as const,
    },
    {
      slug: 'nos-matieres',
      kind: 'page',
      title: ['Nos matières', 'موادنا', 'Our materials'] as const,
      body: [
        '<p>Coton lavé, laine mérinos, velours côtelé, nylon ripstop, cuir tanné végétal. Chaque matière est choisie pour la façon dont elle se comporte après six mois.</p>',
        '<p>قطن مغسول، صوف ميرينو، قطيفة، نايلون، جلد مدبوغ نباتيا.</p>',
        '<p>Washed cotton, merino wool, corduroy, ripstop nylon, vegetable-tanned leather.</p>',
      ] as const,
    },
  ];

  for (const page of pages) {
    await prisma.page.upsert({
      where: { slug: page.slug },
      create: {
        slug: page.slug,
        kind: page.kind,
        title: tr(page.title[0], page.title[1], page.title[2]),
        body: tr(page.body[0], page.body[1], page.body[2]),
        published: true,
        publishedAt: new Date(),
      },
      update: { title: tr(page.title[0], page.title[1], page.title[2]) },
    });
  }
  log('pages', pages.length);

  // --- announcement bar -----------------------------------------------------
  const announcements = [
    {
      message: tr(
        'Livraison gratuite dès 6 000 DA — paiement à la livraison partout en Algérie',
        'توصيل مجاني ابتداء من 6000 دج — الدفع عند الاستلام في كل الولايات',
        'Free delivery over 6 000 DA — cash on delivery across Algeria',
      ),
      position: 0,
    },
    {
      message: tr(
        'Nouvelle collection Heritage — séries numérotées',
        'مجموعة هيريتاج الجديدة — إصدارات مرقمة',
        'New Heritage collection — numbered runs',
      ),
      linkUrl: '/collections/heritage',
      position: 1,
    },
  ];
  for (const announcement of announcements) {
    const existing = await prisma.announcement.findFirst({ where: { position: announcement.position } });
    if (existing) {
      await prisma.announcement.update({ where: { id: existing.id }, data: announcement });
    } else {
      await prisma.announcement.create({ data: announcement });
    }
  }
  log('announcements', announcements.length);

  // --- banners --------------------------------------------------------------
  // One live, one scheduled for next week, so the admin shows both states.
  const inAWeek = new Date(Date.now() + 7 * 86_400_000);

  const banners = [
    {
      name: 'Livraison offerte',
      placement: 'home_mid',
      title: tr('Livraison offerte dès 6 000 DA', 'توصيل مجاني ابتداءً من 6000 دج', 'Free delivery over 6,000 DA'),
      subtitle: tr('58 wilayas, à domicile ou au stop desk', '58 ولاية، إلى المنزل أو نقطة الاستلام', 'All 58 wilayas, home or stop desk'),
      ctaLabel: tr('Voir les tarifs', 'شاهد الأسعار', 'See rates'),
      ctaUrl: '/livraison',
      position: 0,
      active: true,
    },
    {
      name: 'Rentrée — bandeau collection',
      placement: 'collection_top',
      title: tr('Sélection rentrée', 'اختيار الدخول المدرسي', 'Back-to-school picks'),
      ctaLabel: tr('Découvrir', 'اكتشف', 'Discover'),
      ctaUrl: '/collections/nouveautes',
      position: 0,
      active: true,
      startsAt: inAWeek,
    },
  ];

  for (const banner of banners) {
    const existing = await prisma.banner.findFirst({ where: { name: banner.name } });
    if (existing) await prisma.banner.update({ where: { id: existing.id }, data: banner as never });
    else await prisma.banner.create({ data: banner as never });
  }
  log('banners', banners.length);

  // --- home builder sections ------------------------------------------------
  const collections = new Map(
    (await prisma.collection.findMany({ select: { id: true, slug: true } })).map((c) => [c.slug, c.id]),
  );

  const sections = [
    {
      kind: 'hero_3d',
      title: tr('Une casquette qui vieillit bien', 'قبعة تتقادم بشكل جميل', 'A cap that ages well'),
      subtitle: tr(
        'Coupes dessinées à Alger, séries courtes, livraison dans les 58 wilayas.',
        'قصات مصممة في الجزائر العاصمة، سلاسل قصيرة، توصيل إلى 58 ولاية.',
        'Cuts drawn in Algiers, short runs, delivered to all 58 wilayas.',
      ),
      ctaLabel: tr('Voir la collection', 'اكتشف المجموعة', 'Shop the collection'),
      ctaUrl: '/collections/nouveautes',
      config: { modelUrl: '/models/cap-hero.glb', autoRotate: true, parallax: true },
      position: 0,
    },
    {
      kind: 'featured_collections',
      title: tr('Par style', 'حسب الأسلوب', 'By style'),
      config: { slugs: ['nouveautes', 'heritage', 'meilleures-ventes', 'derniere-chance'] },
      position: 1,
    },
    {
      kind: 'new_arrivals',
      title: tr('Nouveautés', 'الجديد', 'New arrivals'),
      collectionId: collections.get('nouveautes'),
      config: { limit: 8, layout: 'carousel' },
      position: 2,
    },
    {
      kind: 'promo_countdown',
      title: tr('Fin de série — jusqu’à -30 %', 'نهاية السلسلة — حتى -30%', 'End of run — up to 30 % off'),
      ctaLabel: tr('En profiter', 'استفد الآن', 'Shop the sale'),
      ctaUrl: '/collections/derniere-chance',
      config: { endsAt: new Date(Date.now() + 5 * 86400000).toISOString() },
      position: 3,
    },
    {
      kind: 'best_sellers',
      title: tr('Les plus portées', 'الأكثر مبيعا', 'Most worn'),
      collectionId: collections.get('meilleures-ventes'),
      config: { limit: 8, layout: 'grid' },
      position: 4,
    },
    {
      kind: 'brand_story',
      title: tr('Fait pour durer', 'صنع ليدوم', 'Built to last'),
      subtitle: tr(
        'Chaque modèle est porté un mois avant d’entrer en production.',
        'كل نموذج يُرتدى شهرا قبل دخوله الإنتاج.',
        'Every model is worn for a month before it goes into production.',
      ),
      ctaLabel: tr('Notre histoire', 'قصتنا', 'Our story'),
      ctaUrl: '/pages/a-propos',
      position: 5,
    },
    {
      kind: 'lookbook',
      title: tr('Le lookbook', 'اللوك بوك', 'The lookbook'),
      subtitle: tr(
        'Portées à Alger, Oran et Constantine.',
        'مصورة في الجزائر ووهران وقسنطينة.',
        'Worn in Algiers, Oran and Constantine.',
      ),
      config: {
        columns: 3,
        images: [
          { caption: 'Alger centre', href: '/collections/nouveautes' },
          { caption: 'Oran, front de mer', href: '/collections/heritage' },
          { caption: 'Constantine', href: '/collections/meilleures-ventes' },
        ],
      },
      position: 6,
    },
    {
      kind: 'testimonials',
      title: tr('Ce qu’en disent nos clients', 'ماذا يقول زبائننا', 'What customers say'),
      config: { limit: 6, minRating: 4 },
      position: 7,
    },
    {
      kind: 'newsletter',
      title: tr('Les drops avant tout le monde', 'الإصدارات قبل الجميع', 'Drops before everyone else'),
      config: { incentive: '10%' },
      position: 8,
    },
  ];

  await prisma.homeSection.deleteMany({});
  for (const section of sections) {
    await prisma.homeSection.create({ data: section as never });
  }
  log('home sections', sections.length);
}
