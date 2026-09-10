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
  /** Chef-lieu coordinates: where a run starts counting distance from. */
  lat: number;
  lng: number;
}

export const WILAYAS: WilayaSeed[] = [
  { code: 1, fr: 'Adrar', ar: 'أدرار', zone: 6, lat: 27.874, lng: -0.294 },
  { code: 2, fr: 'Chlef', ar: 'الشلف', zone: 1, lat: 36.165, lng: 1.334 },
  { code: 3, fr: 'Laghouat', ar: 'الأغواط', zone: 4, lat: 33.8, lng: 2.865 },
  { code: 4, fr: 'Oum El Bouaghi', ar: 'أم البواقي', zone: 2, lat: 35.875, lng: 7.113 },
  { code: 5, fr: 'Batna', ar: 'باتنة', zone: 2, lat: 35.556, lng: 6.178 },
  { code: 6, fr: 'Béjaïa', ar: 'بجاية', zone: 2, lat: 36.75, lng: 5.084 },
  { code: 7, fr: 'Biskra', ar: 'بسكرة', zone: 4, lat: 34.85, lng: 5.728 },
  { code: 8, fr: 'Béchar', ar: 'بشار', zone: 5, lat: 31.617, lng: -2.216 },
  { code: 9, fr: 'Blida', ar: 'البليدة', zone: 1, lat: 36.47, lng: 2.829 },
  { code: 10, fr: 'Bouira', ar: 'البويرة', zone: 1, lat: 36.374, lng: 3.902 },
  { code: 11, fr: 'Tamanrasset', ar: 'تمنراست', zone: 6, lat: 22.785, lng: 5.523 },
  { code: 12, fr: 'Tébessa', ar: 'تبسة', zone: 2, lat: 35.404, lng: 8.124 },
  { code: 13, fr: 'Tlemcen', ar: 'تلمسان', zone: 3, lat: 34.878, lng: -1.315 },
  { code: 14, fr: 'Tiaret', ar: 'تيارت', zone: 4, lat: 35.371, lng: 1.317 },
  { code: 15, fr: 'Tizi Ouzou', ar: 'تيزي وزو', zone: 1, lat: 36.717, lng: 4.047 },
  { code: 16, fr: 'Alger', ar: 'الجزائر', zone: 1, lat: 36.753, lng: 3.059 },
  { code: 17, fr: 'Djelfa', ar: 'الجلفة', zone: 4, lat: 34.673, lng: 3.263 },
  { code: 18, fr: 'Jijel', ar: 'جيجل', zone: 2, lat: 36.821, lng: 5.766 },
  { code: 19, fr: 'Sétif', ar: 'سطيف', zone: 2, lat: 36.19, lng: 5.414 },
  { code: 20, fr: 'Saïda', ar: 'سعيدة', zone: 3, lat: 34.83, lng: 0.151 },
  { code: 21, fr: 'Skikda', ar: 'سكيكدة', zone: 2, lat: 36.876, lng: 6.909 },
  { code: 22, fr: 'Sidi Bel Abbès', ar: 'سيدي بلعباس', zone: 3, lat: 35.189, lng: -0.641 },
  { code: 23, fr: 'Annaba', ar: 'عنابة', zone: 2, lat: 36.9, lng: 7.766 },
  { code: 24, fr: 'Guelma', ar: 'قالمة', zone: 2, lat: 36.462, lng: 7.426 },
  { code: 25, fr: 'Constantine', ar: 'قسنطينة', zone: 2, lat: 36.365, lng: 6.615 },
  { code: 26, fr: 'Médéa', ar: 'المدية', zone: 1, lat: 36.264, lng: 2.754 },
  { code: 27, fr: 'Mostaganem', ar: 'مستغانم', zone: 3, lat: 35.931, lng: 0.089 },
  { code: 28, fr: "M'Sila", ar: 'المسيلة', zone: 4, lat: 35.705, lng: 4.542 },
  { code: 29, fr: 'Mascara', ar: 'معسكر', zone: 3, lat: 35.396, lng: 0.14 },
  { code: 30, fr: 'Ouargla', ar: 'ورقلة', zone: 5, lat: 31.949, lng: 5.325 },
  { code: 31, fr: 'Oran', ar: 'وهران', zone: 3, lat: 35.697, lng: -0.633 },
  { code: 32, fr: 'El Bayadh', ar: 'البيض', zone: 4, lat: 33.681, lng: 1.019 },
  { code: 33, fr: 'Illizi', ar: 'إليزي', zone: 6, lat: 26.483, lng: 8.467 },
  { code: 34, fr: 'Bordj Bou Arreridj', ar: 'برج بوعريريج', zone: 2, lat: 36.073, lng: 4.763 },
  { code: 35, fr: 'Boumerdès', ar: 'بومرداس', zone: 1, lat: 36.759, lng: 3.477 },
  { code: 36, fr: 'El Tarf', ar: 'الطارف', zone: 2, lat: 36.767, lng: 8.314 },
  { code: 37, fr: 'Tindouf', ar: 'تندوف', zone: 6, lat: 27.674, lng: -8.147 },
  { code: 38, fr: 'Tissemsilt', ar: 'تيسمسيلت', zone: 4, lat: 35.607, lng: 1.811 },
  { code: 39, fr: 'El Oued', ar: 'الوادي', zone: 5, lat: 33.368, lng: 6.868 },
  { code: 40, fr: 'Khenchela', ar: 'خنشلة', zone: 2, lat: 35.436, lng: 7.144 },
  { code: 41, fr: 'Souk Ahras', ar: 'سوق أهراس', zone: 2, lat: 36.286, lng: 7.951 },
  { code: 42, fr: 'Tipaza', ar: 'تيبازة', zone: 1, lat: 36.589, lng: 2.448 },
  { code: 43, fr: 'Mila', ar: 'ميلة', zone: 2, lat: 36.45, lng: 6.264 },
  { code: 44, fr: 'Aïn Defla', ar: 'عين الدفلى', zone: 1, lat: 36.264, lng: 1.968 },
  { code: 45, fr: 'Naâma', ar: 'النعامة', zone: 4, lat: 33.267, lng: -0.313 },
  { code: 46, fr: 'Aïn Témouchent', ar: 'عين تموشنت', zone: 3, lat: 35.298, lng: -1.14 },
  { code: 47, fr: 'Ghardaïa', ar: 'غرداية', zone: 5, lat: 32.49, lng: 3.673 },
  { code: 48, fr: 'Relizane', ar: 'غليزان', zone: 3, lat: 35.737, lng: 0.556 },
  { code: 49, fr: "El M'Ghair", ar: 'المغير', zone: 5, lat: 33.954, lng: 5.924 },
  { code: 50, fr: 'El Meniaa', ar: 'المنيعة', zone: 5, lat: 30.583, lng: 2.883 },
  { code: 51, fr: 'Ouled Djellal', ar: 'أولاد جلال', zone: 4, lat: 34.425, lng: 5.062 },
  { code: 52, fr: 'Bordj Baji Mokhtar', ar: 'برج باجي مختار', zone: 6, lat: 21.325, lng: 0.955 },
  { code: 53, fr: 'Béni Abbès', ar: 'بني عباس', zone: 5, lat: 30.13, lng: -2.167 },
  { code: 54, fr: 'Timimoun', ar: 'تيميمون', zone: 6, lat: 29.263, lng: 0.241 },
  { code: 55, fr: 'Touggourt', ar: 'تقرت', zone: 5, lat: 33.1, lng: 6.058 },
  { code: 56, fr: 'Djanet', ar: 'جانت', zone: 6, lat: 24.554, lng: 9.484 },
  { code: 57, fr: 'In Salah', ar: 'عين صالح', zone: 6, lat: 27.194, lng: 2.46 },
  { code: 58, fr: 'In Guezzam', ar: 'عين قزام', zone: 6, lat: 19.568, lng: 5.771 },
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
