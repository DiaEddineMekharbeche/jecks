/**
 * The 58 Algerian wilayas — PRD Section 3 and F-AD-60.
 * `zone` groups them into the shipping bands used to seed default rates:
 *   1 Centre/North, 2 East, 3 West, 4 Highlands, 5 South, 6 Deep south.
 * Codes 49-58 are the wilayas created by the 2019 territorial reform.
 */

export interface WilayaSeed {
  code: number;
  fr: string;
  ar: string;
  zone: 1 | 2 | 3 | 4 | 5 | 6;
}

export const WILAYAS: WilayaSeed[] = [
  { code: 1, fr: 'Adrar', ar: 'أدرار', zone: 6 },
  { code: 2, fr: 'Chlef', ar: 'الشلف', zone: 1 },
  { code: 3, fr: 'Laghouat', ar: 'الأغواط', zone: 4 },
  { code: 4, fr: 'Oum El Bouaghi', ar: 'أم البواقي', zone: 2 },
  { code: 5, fr: 'Batna', ar: 'باتنة', zone: 2 },
  { code: 6, fr: 'Béjaïa', ar: 'بجاية', zone: 2 },
  { code: 7, fr: 'Biskra', ar: 'بسكرة', zone: 4 },
  { code: 8, fr: 'Béchar', ar: 'بشار', zone: 5 },
  { code: 9, fr: 'Blida', ar: 'البليدة', zone: 1 },
  { code: 10, fr: 'Bouira', ar: 'البويرة', zone: 1 },
  { code: 11, fr: 'Tamanrasset', ar: 'تمنراست', zone: 6 },
  { code: 12, fr: 'Tébessa', ar: 'تبسة', zone: 2 },
  { code: 13, fr: 'Tlemcen', ar: 'تلمسان', zone: 3 },
  { code: 14, fr: 'Tiaret', ar: 'تيارت', zone: 4 },
  { code: 15, fr: 'Tizi Ouzou', ar: 'تيزي وزو', zone: 1 },
  { code: 16, fr: 'Alger', ar: 'الجزائر', zone: 1 },
  { code: 17, fr: 'Djelfa', ar: 'الجلفة', zone: 4 },
  { code: 18, fr: 'Jijel', ar: 'جيجل', zone: 2 },
  { code: 19, fr: 'Sétif', ar: 'سطيف', zone: 2 },
  { code: 20, fr: 'Saïda', ar: 'سعيدة', zone: 3 },
  { code: 21, fr: 'Skikda', ar: 'سكيكدة', zone: 2 },
  { code: 22, fr: 'Sidi Bel Abbès', ar: 'سيدي بلعباس', zone: 3 },
  { code: 23, fr: 'Annaba', ar: 'عنابة', zone: 2 },
  { code: 24, fr: 'Guelma', ar: 'قالمة', zone: 2 },
  { code: 25, fr: 'Constantine', ar: 'قسنطينة', zone: 2 },
  { code: 26, fr: 'Médéa', ar: 'المدية', zone: 1 },
  { code: 27, fr: 'Mostaganem', ar: 'مستغانم', zone: 3 },
  { code: 28, fr: "M'Sila", ar: 'المسيلة', zone: 4 },
  { code: 29, fr: 'Mascara', ar: 'معسكر', zone: 3 },
  { code: 30, fr: 'Ouargla', ar: 'ورقلة', zone: 5 },
  { code: 31, fr: 'Oran', ar: 'وهران', zone: 3 },
  { code: 32, fr: 'El Bayadh', ar: 'البيض', zone: 4 },
  { code: 33, fr: 'Illizi', ar: 'إليزي', zone: 6 },
  { code: 34, fr: 'Bordj Bou Arreridj', ar: 'برج بوعريريج', zone: 2 },
  { code: 35, fr: 'Boumerdès', ar: 'بومرداس', zone: 1 },
  { code: 36, fr: 'El Tarf', ar: 'الطارف', zone: 2 },
  { code: 37, fr: 'Tindouf', ar: 'تندوف', zone: 6 },
  { code: 38, fr: 'Tissemsilt', ar: 'تيسمسيلت', zone: 4 },
  { code: 39, fr: 'El Oued', ar: 'الوادي', zone: 5 },
  { code: 40, fr: 'Khenchela', ar: 'خنشلة', zone: 2 },
  { code: 41, fr: 'Souk Ahras', ar: 'سوق أهراس', zone: 2 },
  { code: 42, fr: 'Tipaza', ar: 'تيبازة', zone: 1 },
  { code: 43, fr: 'Mila', ar: 'ميلة', zone: 2 },
  { code: 44, fr: 'Aïn Defla', ar: 'عين الدفلى', zone: 1 },
  { code: 45, fr: 'Naâma', ar: 'النعامة', zone: 4 },
  { code: 46, fr: 'Aïn Témouchent', ar: 'عين تموشنت', zone: 3 },
  { code: 47, fr: 'Ghardaïa', ar: 'غرداية', zone: 5 },
  { code: 48, fr: 'Relizane', ar: 'غليزان', zone: 3 },
  { code: 49, fr: "El M'Ghair", ar: 'المغير', zone: 5 },
  { code: 50, fr: 'El Meniaa', ar: 'المنيعة', zone: 5 },
  { code: 51, fr: 'Ouled Djellal', ar: 'أولاد جلال', zone: 4 },
  { code: 52, fr: 'Bordj Baji Mokhtar', ar: 'برج باجي مختار', zone: 6 },
  { code: 53, fr: 'Béni Abbès', ar: 'بني عباس', zone: 5 },
  { code: 54, fr: 'Timimoun', ar: 'تيميمون', zone: 6 },
  { code: 55, fr: 'Touggourt', ar: 'تقرت', zone: 5 },
  { code: 56, fr: 'Djanet', ar: 'جانت', zone: 6 },
  { code: 57, fr: 'In Salah', ar: 'عين صالح', zone: 6 },
  { code: 58, fr: 'In Guezzam', ar: 'عين قزام', zone: 6 },
];

/**
 * Default home-delivery price and our cost, per zone, in centimes.
 * Stop-desk is cheaper; the seed derives it from these.
 */
export const ZONE_RATES: Record<
  WilayaSeed['zone'],
  { homePrice: number; homeCost: number; deskPrice: number; deskCost: number; etaMin: number; etaMax: number }
> = {
  1: { homePrice: 40000, homeCost: 28000, deskPrice: 25000, deskCost: 18000, etaMin: 1, etaMax: 2 },
  2: { homePrice: 50000, homeCost: 35000, deskPrice: 30000, deskCost: 22000, etaMin: 2, etaMax: 3 },
  3: { homePrice: 50000, homeCost: 35000, deskPrice: 30000, deskCost: 22000, etaMin: 2, etaMax: 3 },
  4: { homePrice: 60000, homeCost: 42000, deskPrice: 35000, deskCost: 26000, etaMin: 2, etaMax: 4 },
  5: { homePrice: 80000, homeCost: 58000, deskPrice: 50000, deskCost: 38000, etaMin: 3, etaMax: 5 },
  6: { homePrice: 100000, homeCost: 74000, deskPrice: 60000, deskCost: 46000, etaMin: 4, etaMax: 7 },
};

export const ZONE_NAMES: Record<WilayaSeed['zone'], { fr: string; ar: string; en: string }> = {
  1: { fr: 'Centre', ar: 'الوسط', en: 'Centre' },
  2: { fr: 'Est', ar: 'الشرق', en: 'East' },
  3: { fr: 'Ouest', ar: 'الغرب', en: 'West' },
  4: { fr: 'Hauts Plateaux', ar: 'الهضاب العليا', en: 'Highlands' },
  5: { fr: 'Sud', ar: 'الجنوب', en: 'South' },
  6: { fr: 'Grand Sud', ar: 'الجنوب الكبير', en: 'Deep South' },
};
