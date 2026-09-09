/**
 * Communes per wilaya.
 *
 * Algeria has 1 541 communes. This file seeds the chef-lieu of every wilaya plus the
 * communes that carry real delivery volume, which is what checkout and shipping rates
 * need on day one. It is deliberately a curated subset, not the full register.
 *
 * To load the complete official list, drop the ONS CSV (wilaya_code,commune_name_fr,
 * commune_name_ar,postal_code) at packages/db/prisma/seed/data/communes.csv and run
 * `pnpm --filter @jecks/db exec tsx prisma/seed/import-communes.ts`. The importer is
 * idempotent and upserts on (wilayaCode, nameAscii), so it merges with what is here.
 */

export interface CommuneSeed {
  wilaya: number;
  fr: string;
  ar: string;
}

export const COMMUNES: CommuneSeed[] = [
  // 01 Adrar
  { wilaya: 1, fr: 'Adrar', ar: 'أدرار' },
  { wilaya: 1, fr: 'Reggane', ar: 'رقان' },
  { wilaya: 1, fr: 'Aoulef', ar: 'أولف' },
  { wilaya: 1, fr: 'Zaouiet Kounta', ar: 'زاوية كنتة' },
  { wilaya: 1, fr: 'Fenoughil', ar: 'فنوغيل' },

  // 02 Chlef
  { wilaya: 2, fr: 'Chlef', ar: 'الشلف' },
  { wilaya: 2, fr: 'Ténès', ar: 'تنس' },
  { wilaya: 2, fr: 'Ouled Fares', ar: 'أولاد فارس' },
  { wilaya: 2, fr: 'Boukadir', ar: 'بوقادير' },
  { wilaya: 2, fr: 'Oued Fodda', ar: 'وادي الفضة' },
  { wilaya: 2, fr: 'El Karimia', ar: 'الكريمية' },
  { wilaya: 2, fr: 'Abou El Hassan', ar: 'أبو الحسن' },

  // 03 Laghouat
  { wilaya: 3, fr: 'Laghouat', ar: 'الأغواط' },
  { wilaya: 3, fr: 'Aflou', ar: 'أفلو' },
  { wilaya: 3, fr: 'Ksar El Hirane', ar: 'قصر الحيران' },
  { wilaya: 3, fr: 'Hassi R Mel', ar: 'حاسي الرمل' },
  { wilaya: 3, fr: 'Aïn Madhi', ar: 'عين ماضي' },

  // 04 Oum El Bouaghi
  { wilaya: 4, fr: 'Oum El Bouaghi', ar: 'أم البواقي' },
  { wilaya: 4, fr: 'Aïn Beïda', ar: 'عين البيضاء' },
  { wilaya: 4, fr: "Aïn M'lila", ar: 'عين مليلة' },
  { wilaya: 4, fr: 'Aïn Fakroun', ar: 'عين فكرون' },
  { wilaya: 4, fr: 'Meskiana', ar: 'مسكيانة' },
  { wilaya: 4, fr: 'Aïn Kercha', ar: 'عين كرشة' },
  { wilaya: 4, fr: 'Ksar Sbahi', ar: 'قصر الصباحي' },

  // 05 Batna
  { wilaya: 5, fr: 'Batna', ar: 'باتنة' },
  { wilaya: 5, fr: 'Barika', ar: 'بريكة' },
  { wilaya: 5, fr: 'Merouana', ar: 'مروانة' },
  { wilaya: 5, fr: 'Aïn Touta', ar: 'عين التوتة' },
  { wilaya: 5, fr: 'Arris', ar: 'أريس' },
  { wilaya: 5, fr: "N'Gaous", ar: 'نقاوس' },
  { wilaya: 5, fr: 'Tazoult', ar: 'تازولت' },
  { wilaya: 5, fr: 'Timgad', ar: 'تيمقاد' },
  { wilaya: 5, fr: 'Ras El Aioun', ar: 'رأس العيون' },

  // 06 Béjaïa
  { wilaya: 6, fr: 'Béjaïa', ar: 'بجاية' },
  { wilaya: 6, fr: 'Akbou', ar: 'أقبو' },
  { wilaya: 6, fr: 'El Kseur', ar: 'القصر' },
  { wilaya: 6, fr: 'Amizour', ar: 'أميزور' },
  { wilaya: 6, fr: 'Sidi Aïch', ar: 'سيدي عيش' },
  { wilaya: 6, fr: 'Tichy', ar: 'تيشي' },
  { wilaya: 6, fr: 'Aokas', ar: 'أوقاس' },
  { wilaya: 6, fr: 'Kherrata', ar: 'خراطة' },
  { wilaya: 6, fr: 'Souk El Tenine', ar: 'سوق الاثنين' },
  { wilaya: 6, fr: 'Tazmalt', ar: 'تازمالت' },
  { wilaya: 6, fr: 'Seddouk', ar: 'صدوق' },

  // 07 Biskra
  { wilaya: 7, fr: 'Biskra', ar: 'بسكرة' },
  { wilaya: 7, fr: 'Tolga', ar: 'طولقة' },
  { wilaya: 7, fr: 'Sidi Okba', ar: 'سيدي عقبة' },
  { wilaya: 7, fr: 'Ouled Djellal', ar: 'أولاد جلال' },
  { wilaya: 7, fr: 'El Kantara', ar: 'القنطرة' },
  { wilaya: 7, fr: 'Zeribet El Oued', ar: 'زريبة الوادي' },

  // 08 Béchar
  { wilaya: 8, fr: 'Béchar', ar: 'بشار' },
  { wilaya: 8, fr: 'Kenadsa', ar: 'القنادسة' },
  { wilaya: 8, fr: 'Abadla', ar: 'العبادلة' },
  { wilaya: 8, fr: 'Taghit', ar: 'تاغيت' },

  // 09 Blida
  { wilaya: 9, fr: 'Blida', ar: 'البليدة' },
  { wilaya: 9, fr: 'Boufarik', ar: 'بوفاريك' },
  { wilaya: 9, fr: 'Bougara', ar: 'بوقرة' },
  { wilaya: 9, fr: 'Larbaâ', ar: 'الأربعاء' },
  { wilaya: 9, fr: 'Meftah', ar: 'مفتاح' },
  { wilaya: 9, fr: 'Ouled Yaïch', ar: 'أولاد يعيش' },
  { wilaya: 9, fr: 'Soumaa', ar: 'الصومعة' },
  { wilaya: 9, fr: 'El Affroun', ar: 'العفرون' },
  { wilaya: 9, fr: 'Mouzaia', ar: 'موزاية' },
  { wilaya: 9, fr: 'Chiffa', ar: 'الشفة' },
  { wilaya: 9, fr: 'Beni Mered', ar: 'بني مراد' },
  { wilaya: 9, fr: 'Bouinan', ar: 'بوينان' },
  { wilaya: 9, fr: 'Oued El Alleug', ar: 'وادي العلايق' },

  // 10 Bouira
  { wilaya: 10, fr: 'Bouira', ar: 'البويرة' },
  { wilaya: 10, fr: 'Lakhdaria', ar: 'الأخضرية' },
  { wilaya: 10, fr: 'Sour El Ghozlane', ar: 'سور الغزلان' },
  { wilaya: 10, fr: "M'Chedallah", ar: 'مشدالة' },
  { wilaya: 10, fr: 'Aïn Bessem', ar: 'عين بسام' },
  { wilaya: 10, fr: 'Kadiria', ar: 'قادرية' },
  { wilaya: 10, fr: 'Bechloul', ar: 'بشلول' },

  // 11 Tamanrasset
  { wilaya: 11, fr: 'Tamanrasset', ar: 'تمنراست' },
  { wilaya: 11, fr: 'Abalessa', ar: 'أبلسة' },
  { wilaya: 11, fr: 'Idles', ar: 'إيدلس' },

  // 12 Tébessa
  { wilaya: 12, fr: 'Tébessa', ar: 'تبسة' },
  { wilaya: 12, fr: 'Bir El Ater', ar: 'بئر العاتر' },
  { wilaya: 12, fr: 'Cheria', ar: 'الشريعة' },
  { wilaya: 12, fr: 'El Aouinet', ar: 'العوينات' },
  { wilaya: 12, fr: 'Ouenza', ar: 'الونزة' },
  { wilaya: 12, fr: 'Morsott', ar: 'مرسط' },

  // 13 Tlemcen
  { wilaya: 13, fr: 'Tlemcen', ar: 'تلمسان' },
  { wilaya: 13, fr: 'Maghnia', ar: 'مغنية' },
  { wilaya: 13, fr: 'Remchi', ar: 'الرمشي' },
  { wilaya: 13, fr: 'Ghazaouet', ar: 'الغزوات' },
  { wilaya: 13, fr: 'Sebdou', ar: 'سبدو' },
  { wilaya: 13, fr: 'Nedroma', ar: 'ندرومة' },
  { wilaya: 13, fr: 'Chetouane', ar: 'شتوان' },
  { wilaya: 13, fr: 'Mansourah', ar: 'المنصورة' },

  // 14 Tiaret
  { wilaya: 14, fr: 'Tiaret', ar: 'تيارت' },
  { wilaya: 14, fr: 'Frenda', ar: 'فرندة' },
  { wilaya: 14, fr: 'Sougueur', ar: 'السوقر' },
  { wilaya: 14, fr: 'Mahdia', ar: 'المهدية' },
  { wilaya: 14, fr: 'Ksar Chellala', ar: 'قصر الشلالة' },
  { wilaya: 14, fr: 'Aïn Deheb', ar: 'عين الذهب' },

  // 15 Tizi Ouzou
  { wilaya: 15, fr: 'Tizi Ouzou', ar: 'تيزي وزو' },
  { wilaya: 15, fr: 'Azazga', ar: 'عزازقة' },
  { wilaya: 15, fr: 'Draa Ben Khedda', ar: 'ذراع بن خدة' },
  { wilaya: 15, fr: 'Boghni', ar: 'بوغني' },
  { wilaya: 15, fr: 'Larbaa Nath Irathen', ar: 'الأربعاء نايث إيراثن' },
  { wilaya: 15, fr: 'Aïn El Hammam', ar: 'عين الحمام' },
  { wilaya: 15, fr: 'Draa El Mizan', ar: 'ذراع الميزان' },
  { wilaya: 15, fr: 'Tigzirt', ar: 'تيقزيرت' },
  { wilaya: 15, fr: 'Azeffoun', ar: 'أزفون' },
  { wilaya: 15, fr: 'Mekla', ar: 'مقلع' },
  { wilaya: 15, fr: 'Freha', ar: 'فريحة' },
  { wilaya: 15, fr: 'Beni Douala', ar: 'بني دوالة' },

  // 16 Alger
  { wilaya: 16, fr: 'Alger Centre', ar: 'الجزائر الوسطى' },
  { wilaya: 16, fr: 'Sidi M Hamed', ar: 'سيدي امحمد' },
  { wilaya: 16, fr: 'El Madania', ar: 'المدنية' },
  { wilaya: 16, fr: 'Belouizdad', ar: 'بلوزداد' },
  { wilaya: 16, fr: 'Bab El Oued', ar: 'باب الوادي' },
  { wilaya: 16, fr: 'Bologhine', ar: 'بولوغين' },
  { wilaya: 16, fr: 'Casbah', ar: 'القصبة' },
  { wilaya: 16, fr: 'Oued Koriche', ar: 'وادي قريش' },
  { wilaya: 16, fr: 'Bir Mourad Raïs', ar: 'بئر مراد رايس' },
  { wilaya: 16, fr: 'El Biar', ar: 'الأبيار' },
  { wilaya: 16, fr: 'Bouzareah', ar: 'بوزريعة' },
  { wilaya: 16, fr: 'Birkhadem', ar: 'بئر خادم' },
  { wilaya: 16, fr: 'Hydra', ar: 'حيدرة' },
  { wilaya: 16, fr: 'Kouba', ar: 'القبة' },
  { wilaya: 16, fr: 'Bachdjerrah', ar: 'باش جراح' },
  { wilaya: 16, fr: 'Hussein Dey', ar: 'حسين داي' },
  { wilaya: 16, fr: 'El Harrach', ar: 'الحراش' },
  { wilaya: 16, fr: 'Bourouba', ar: 'بوروبة' },
  { wilaya: 16, fr: 'Baraki', ar: 'براقي' },
  { wilaya: 16, fr: 'Les Eucalyptus', ar: 'الكاليتوس' },
  { wilaya: 16, fr: 'Bab Ezzouar', ar: 'باب الزوار' },
  { wilaya: 16, fr: 'Dar El Beida', ar: 'الدار البيضاء' },
  { wilaya: 16, fr: 'Bordj El Kiffan', ar: 'برج الكيفان' },
  { wilaya: 16, fr: 'Bordj El Bahri', ar: 'برج البحري' },
  { wilaya: 16, fr: 'Aïn Taya', ar: 'عين طاية' },
  { wilaya: 16, fr: 'Rouiba', ar: 'الرويبة' },
  { wilaya: 16, fr: 'Reghaia', ar: 'رغاية' },
  { wilaya: 16, fr: 'Herraoua', ar: 'هراوة' },
  { wilaya: 16, fr: 'Mohammadia', ar: 'المحمدية' },
  { wilaya: 16, fr: 'Oued Smar', ar: 'وادي السمار' },
  { wilaya: 16, fr: 'Gué de Constantine', ar: 'مخاضة قسنطينة' },
  { wilaya: 16, fr: 'Djasr Kasentina', ar: 'جسر قسنطينة' },
  { wilaya: 16, fr: 'Saoula', ar: 'السحاولة' },
  { wilaya: 16, fr: 'Draria', ar: 'الدرارية' },
  { wilaya: 16, fr: 'El Achour', ar: 'العاشور' },
  { wilaya: 16, fr: 'Ouled Fayet', ar: 'أولاد فايت' },
  { wilaya: 16, fr: 'Dely Ibrahim', ar: 'دالي إبراهيم' },
  { wilaya: 16, fr: 'Cheraga', ar: 'الشراقة' },
  { wilaya: 16, fr: 'Aïn Benian', ar: 'عين البنيان' },
  { wilaya: 16, fr: 'Beni Messous', ar: 'بني مسوس' },
  { wilaya: 16, fr: 'Staoueli', ar: 'سطاوالي' },
  { wilaya: 16, fr: 'Zeralda', ar: 'زرالدة' },
  { wilaya: 16, fr: 'Douera', ar: 'الدويرة' },
  { wilaya: 16, fr: 'Birtouta', ar: 'بئر توتة' },
  { wilaya: 16, fr: 'Sidi Moussa', ar: 'سيدي موسى' },

  // 17 Djelfa
  { wilaya: 17, fr: 'Djelfa', ar: 'الجلفة' },
  { wilaya: 17, fr: 'Aïn Oussera', ar: 'عين وسارة' },
  { wilaya: 17, fr: 'Messaad', ar: 'مسعد' },
  { wilaya: 17, fr: 'Hassi Bahbah', ar: 'حاسي بحبح' },
  { wilaya: 17, fr: 'El Idrissia', ar: 'الإدريسية' },
  { wilaya: 17, fr: 'Birine', ar: 'بيرين' },

  // 18 Jijel
  { wilaya: 18, fr: 'Jijel', ar: 'جيجل' },
  { wilaya: 18, fr: 'Taher', ar: 'الطاهير' },
  { wilaya: 18, fr: 'El Milia', ar: 'الميلية' },
  { wilaya: 18, fr: 'Chekfa', ar: 'الشقفة' },
  { wilaya: 18, fr: 'Ziama Mansouriah', ar: 'زيامة منصورية' },

  // 19 Sétif
  { wilaya: 19, fr: 'Sétif', ar: 'سطيف' },
  { wilaya: 19, fr: 'El Eulma', ar: 'العلمة' },
  { wilaya: 19, fr: 'Aïn Oulmene', ar: 'عين ولمان' },
  { wilaya: 19, fr: 'Bougaa', ar: 'بوقاعة' },
  { wilaya: 19, fr: 'Aïn Arnat', ar: 'عين أرنات' },
  { wilaya: 19, fr: 'Aïn Azel', ar: 'عين آزال' },
  { wilaya: 19, fr: 'Djemila', ar: 'جميلة' },
  { wilaya: 19, fr: 'Aïn El Kebira', ar: 'عين الكبيرة' },
  { wilaya: 19, fr: 'Salah Bey', ar: 'صالح باي' },
  { wilaya: 19, fr: 'Guenzet', ar: 'قنزات' },

  // 20 Saïda
  { wilaya: 20, fr: 'Saïda', ar: 'سعيدة' },
  { wilaya: 20, fr: 'Aïn El Hadjar', ar: 'عين الحجر' },
  { wilaya: 20, fr: 'Youb', ar: 'يوب' },
  { wilaya: 20, fr: 'Ouled Brahim', ar: 'أولاد إبراهيم' },

  // 21 Skikda
  { wilaya: 21, fr: 'Skikda', ar: 'سكيكدة' },
  { wilaya: 21, fr: 'Collo', ar: 'القل' },
  { wilaya: 21, fr: 'Azzaba', ar: 'عزابة' },
  { wilaya: 21, fr: 'El Harrouch', ar: 'الحروش' },
  { wilaya: 21, fr: 'Tamalous', ar: 'تمالوس' },
  { wilaya: 21, fr: 'Ramdane Djamel', ar: 'رمضان جمال' },

  // 22 Sidi Bel Abbès
  { wilaya: 22, fr: 'Sidi Bel Abbès', ar: 'سيدي بلعباس' },
  { wilaya: 22, fr: 'Telagh', ar: 'تلاغ' },
  { wilaya: 22, fr: 'Sfisef', ar: 'سفيزف' },
  { wilaya: 22, fr: 'Ben Badis', ar: 'بن باديس' },
  { wilaya: 22, fr: 'Ras El Ma', ar: 'رأس الماء' },

  // 23 Annaba
  { wilaya: 23, fr: 'Annaba', ar: 'عنابة' },
  { wilaya: 23, fr: 'El Bouni', ar: 'البوني' },
  { wilaya: 23, fr: 'El Hadjar', ar: 'الحجار' },
  { wilaya: 23, fr: 'Sidi Amar', ar: 'سيدي عمار' },
  { wilaya: 23, fr: 'Berrahal', ar: 'برحال' },
  { wilaya: 23, fr: 'Seraïdi', ar: 'سرايدي' },
  { wilaya: 23, fr: 'Aïn Berda', ar: 'عين الباردة' },
  { wilaya: 23, fr: 'Chetaïbi', ar: 'شطايبي' },

  // 24 Guelma
  { wilaya: 24, fr: 'Guelma', ar: 'قالمة' },
  { wilaya: 24, fr: 'Oued Zenati', ar: 'وادي الزناتي' },
  { wilaya: 24, fr: 'Bouchegouf', ar: 'بوشقوف' },
  { wilaya: 24, fr: 'Héliopolis', ar: 'هيليوبوليس' },
  { wilaya: 24, fr: 'Hammam Debagh', ar: 'حمام دباغ' },

  // 25 Constantine
  { wilaya: 25, fr: 'Constantine', ar: 'قسنطينة' },
  { wilaya: 25, fr: 'El Khroub', ar: 'الخروب' },
  { wilaya: 25, fr: 'Aïn Smara', ar: 'عين سمارة' },
  { wilaya: 25, fr: 'Hamma Bouziane', ar: 'حامة بوزيان' },
  { wilaya: 25, fr: 'Didouche Mourad', ar: 'ديدوش مراد' },
  { wilaya: 25, fr: 'Zighoud Youcef', ar: 'زيغود يوسف' },
  { wilaya: 25, fr: 'Aïn Abid', ar: 'عين عبيد' },
  { wilaya: 25, fr: 'Ouled Rahmoune', ar: 'أولاد رحمون' },

  // 26 Médéa
  { wilaya: 26, fr: 'Médéa', ar: 'المدية' },
  { wilaya: 26, fr: 'Berrouaghia', ar: 'البرواقية' },
  { wilaya: 26, fr: 'Ksar El Boukhari', ar: 'قصر البخاري' },
  { wilaya: 26, fr: 'Beni Slimane', ar: 'بني سليمان' },
  { wilaya: 26, fr: 'Tablat', ar: 'تابلاط' },
  { wilaya: 26, fr: 'Ouzera', ar: 'وزرة' },

  // 27 Mostaganem
  { wilaya: 27, fr: 'Mostaganem', ar: 'مستغانم' },
  { wilaya: 27, fr: 'Aïn Tédelès', ar: 'عين تادلس' },
  { wilaya: 27, fr: 'Sidi Ali', ar: 'سيدي علي' },
  { wilaya: 27, fr: 'Hassi Mameche', ar: 'حاسي مماش' },
  { wilaya: 27, fr: 'Bouguirat', ar: 'بوقيراط' },

  // 28 M'Sila
  { wilaya: 28, fr: "M'Sila", ar: 'المسيلة' },
  { wilaya: 28, fr: 'Bou Saâda', ar: 'بوسعادة' },
  { wilaya: 28, fr: 'Sidi Aïssa', ar: 'سيدي عيسى' },
  { wilaya: 28, fr: 'Aïn El Melh', ar: 'عين الملح' },
  { wilaya: 28, fr: 'Magra', ar: 'مقرة' },
  { wilaya: 28, fr: 'Hammam Dhalaa', ar: 'حمام الضلعة' },

  // 29 Mascara
  { wilaya: 29, fr: 'Mascara', ar: 'معسكر' },
  { wilaya: 29, fr: 'Sig', ar: 'سيق' },
  { wilaya: 29, fr: 'Mohammadia', ar: 'المحمدية' },
  { wilaya: 29, fr: 'Tighennif', ar: 'تيغنيف' },
  { wilaya: 29, fr: 'Bouhanifia', ar: 'بوحنيفية' },

  // 30 Ouargla
  { wilaya: 30, fr: 'Ouargla', ar: 'ورقلة' },
  { wilaya: 30, fr: 'Hassi Messaoud', ar: 'حاسي مسعود' },
  { wilaya: 30, fr: 'Rouissat', ar: 'الرويسات' },
  { wilaya: 30, fr: "N'Goussa", ar: 'انقوسة' },

  // 31 Oran
  { wilaya: 31, fr: 'Oran', ar: 'وهران' },
  { wilaya: 31, fr: 'Bir El Djir', ar: 'بئر الجير' },
  { wilaya: 31, fr: 'Es Senia', ar: 'السانية' },
  { wilaya: 31, fr: 'Arzew', ar: 'أرزيو' },
  { wilaya: 31, fr: 'Bethioua', ar: 'بطيوة' },
  { wilaya: 31, fr: 'Aïn El Turk', ar: 'عين الترك' },
  { wilaya: 31, fr: 'Gdyel', ar: 'قديل' },
  { wilaya: 31, fr: 'Mers El Kébir', ar: 'المرسى الكبير' },
  { wilaya: 31, fr: 'Hassi Bounif', ar: 'حاسي بونيف' },
  { wilaya: 31, fr: 'Sidi Chami', ar: 'سيدي الشحمي' },
  { wilaya: 31, fr: 'Boutlelis', ar: 'بوتليليس' },
  { wilaya: 31, fr: 'Oued Tlelat', ar: 'وادي تليلات' },
  { wilaya: 31, fr: 'Misserghin', ar: 'مسرغين' },

  // 32 El Bayadh
  { wilaya: 32, fr: 'El Bayadh', ar: 'البيض' },
  { wilaya: 32, fr: 'Bougtoub', ar: 'بوقطب' },
  { wilaya: 32, fr: 'Rogassa', ar: 'رقاصة' },

  // 33 Illizi
  { wilaya: 33, fr: 'Illizi', ar: 'إليزي' },
  { wilaya: 33, fr: 'In Amenas', ar: 'عين أميناس' },
  { wilaya: 33, fr: 'Debdeb', ar: 'دبداب' },

  // 34 Bordj Bou Arreridj
  { wilaya: 34, fr: 'Bordj Bou Arreridj', ar: 'برج بوعريريج' },
  { wilaya: 34, fr: 'Ras El Oued', ar: 'رأس الوادي' },
  { wilaya: 34, fr: 'Mansoura', ar: 'المنصورة' },
  { wilaya: 34, fr: 'El Achir', ar: 'العشير' },
  { wilaya: 34, fr: 'Medjana', ar: 'مجانة' },

  // 35 Boumerdès
  { wilaya: 35, fr: 'Boumerdès', ar: 'بومرداس' },
  { wilaya: 35, fr: 'Boudouaou', ar: 'بودواو' },
  { wilaya: 35, fr: 'Dellys', ar: 'دلس' },
  { wilaya: 35, fr: 'Bordj Menaiel', ar: 'برج منايل' },
  { wilaya: 35, fr: 'Khemis El Khechna', ar: 'خميس الخشنة' },
  { wilaya: 35, fr: 'Zemmouri', ar: 'زموري' },
  { wilaya: 35, fr: 'Naciria', ar: 'الناصرية' },

  // 36 El Tarf
  { wilaya: 36, fr: 'El Tarf', ar: 'الطارف' },
  { wilaya: 36, fr: 'El Kala', ar: 'القالة' },
  { wilaya: 36, fr: 'Ben Mehidi', ar: 'بن مهيدي' },
  { wilaya: 36, fr: 'Bouhadjar', ar: 'بوحجار' },
  { wilaya: 36, fr: 'Dréan', ar: 'الذرعان' },

  // 37 Tindouf
  { wilaya: 37, fr: 'Tindouf', ar: 'تندوف' },
  { wilaya: 37, fr: 'Oum El Assel', ar: 'أم العسل' },

  // 38 Tissemsilt
  { wilaya: 38, fr: 'Tissemsilt', ar: 'تيسمسيلت' },
  { wilaya: 38, fr: 'Théniet El Had', ar: 'ثنية الأحد' },
  { wilaya: 38, fr: 'Bordj Bou Naama', ar: 'برج بونعامة' },
  { wilaya: 38, fr: 'Lardjem', ar: 'لرجام' },

  // 39 El Oued
  { wilaya: 39, fr: 'El Oued', ar: 'الوادي' },
  { wilaya: 39, fr: 'Guemar', ar: 'قمار' },
  { wilaya: 39, fr: 'Debila', ar: 'الدبيلة' },
  { wilaya: 39, fr: 'Robbah', ar: 'الرباح' },
  { wilaya: 39, fr: 'Reguiba', ar: 'الرقيبة' },

  // 40 Khenchela
  { wilaya: 40, fr: 'Khenchela', ar: 'خنشلة' },
  { wilaya: 40, fr: 'Kais', ar: 'قايس' },
  { wilaya: 40, fr: 'Chechar', ar: 'ششار' },
  { wilaya: 40, fr: 'Ouled Rechache', ar: 'أولاد رشاش' },

  // 41 Souk Ahras
  { wilaya: 41, fr: 'Souk Ahras', ar: 'سوق أهراس' },
  { wilaya: 41, fr: 'Sedrata', ar: 'سدراتة' },
  { wilaya: 41, fr: 'M Daourouch', ar: 'مداوروش' },
  { wilaya: 41, fr: 'Taoura', ar: 'تاورة' },

  // 42 Tipaza
  { wilaya: 42, fr: 'Tipaza', ar: 'تيبازة' },
  { wilaya: 42, fr: 'Koléa', ar: 'القليعة' },
  { wilaya: 42, fr: 'Cherchell', ar: 'شرشال' },
  { wilaya: 42, fr: 'Hadjout', ar: 'حجوط' },
  { wilaya: 42, fr: 'Fouka', ar: 'فوكة' },
  { wilaya: 42, fr: 'Bou Ismaïl', ar: 'بو إسماعيل' },
  { wilaya: 42, fr: 'Douaouda', ar: 'دواودة' },
  { wilaya: 42, fr: 'Ahmer El Aïn', ar: 'أحمر العين' },

  // 43 Mila
  { wilaya: 43, fr: 'Mila', ar: 'ميلة' },
  { wilaya: 43, fr: 'Chelghoum Laïd', ar: 'شلغوم العيد' },
  { wilaya: 43, fr: 'Ferdjioua', ar: 'فرجيوة' },
  { wilaya: 43, fr: 'Grarem Gouga', ar: 'قرارم قوقة' },
  { wilaya: 43, fr: 'Teleghma', ar: 'تلاغمة' },

  // 44 Aïn Defla
  { wilaya: 44, fr: 'Aïn Defla', ar: 'عين الدفلى' },
  { wilaya: 44, fr: 'Khemis Miliana', ar: 'خميس مليانة' },
  { wilaya: 44, fr: 'Miliana', ar: 'مليانة' },
  { wilaya: 44, fr: 'El Attaf', ar: 'العطاف' },
  { wilaya: 44, fr: 'Djelida', ar: 'جليدة' },

  // 45 Naâma
  { wilaya: 45, fr: 'Naâma', ar: 'النعامة' },
  { wilaya: 45, fr: 'Mécheria', ar: 'المشرية' },
  { wilaya: 45, fr: 'Aïn Sefra', ar: 'عين الصفراء' },

  // 46 Aïn Témouchent
  { wilaya: 46, fr: 'Aïn Témouchent', ar: 'عين تموشنت' },
  { wilaya: 46, fr: 'Hammam Bou Hadjar', ar: 'حمام بوحجر' },
  { wilaya: 46, fr: 'Beni Saf', ar: 'بني صاف' },
  { wilaya: 46, fr: 'El Malah', ar: 'المالح' },

  // 47 Ghardaïa
  { wilaya: 47, fr: 'Ghardaïa', ar: 'غرداية' },
  { wilaya: 47, fr: 'Metlili', ar: 'متليلي' },
  { wilaya: 47, fr: 'Berriane', ar: 'بريان' },
  { wilaya: 47, fr: 'El Guerrara', ar: 'القرارة' },
  { wilaya: 47, fr: 'Bounoura', ar: 'بنورة' },

  // 48 Relizane
  { wilaya: 48, fr: 'Relizane', ar: 'غليزان' },
  { wilaya: 48, fr: 'Oued Rhiou', ar: 'وادي رهيو' },
  { wilaya: 48, fr: 'Mazouna', ar: 'مازونة' },
  { wilaya: 48, fr: 'Zemmoura', ar: 'زمورة' },
  { wilaya: 48, fr: 'Ammi Moussa', ar: 'عمي موسى' },

  // 49 El M'Ghair
  { wilaya: 49, fr: "El M'Ghair", ar: 'المغير' },
  { wilaya: 49, fr: 'Djamaa', ar: 'جامعة' },
  { wilaya: 49, fr: 'Still', ar: 'سطيل' },

  // 50 El Meniaa
  { wilaya: 50, fr: 'El Meniaa', ar: 'المنيعة' },
  { wilaya: 50, fr: 'Hassi Gara', ar: 'حاسي القارة' },

  // 51 Ouled Djellal
  { wilaya: 51, fr: 'Ouled Djellal', ar: 'أولاد جلال' },
  { wilaya: 51, fr: 'Sidi Khaled', ar: 'سيدي خالد' },
  { wilaya: 51, fr: 'Doucen', ar: 'الدوسن' },

  // 52 Bordj Baji Mokhtar
  { wilaya: 52, fr: 'Bordj Baji Mokhtar', ar: 'برج باجي مختار' },
  { wilaya: 52, fr: 'Timiaouine', ar: 'تيمياوين' },

  // 53 Béni Abbès
  { wilaya: 53, fr: 'Béni Abbès', ar: 'بني عباس' },
  { wilaya: 53, fr: 'Igli', ar: 'إقلي' },
  { wilaya: 53, fr: 'Kerzaz', ar: 'كرزاز' },

  // 54 Timimoun
  { wilaya: 54, fr: 'Timimoun', ar: 'تيميمون' },
  { wilaya: 54, fr: 'Aougrout', ar: 'أوقروت' },
  { wilaya: 54, fr: 'Charouine', ar: 'شروين' },

  // 55 Touggourt
  { wilaya: 55, fr: 'Touggourt', ar: 'تقرت' },
  { wilaya: 55, fr: 'Temacine', ar: 'تماسين' },
  { wilaya: 55, fr: 'Megarine', ar: 'المقارين' },
  { wilaya: 55, fr: 'El Hadjira', ar: 'الحجيرة' },

  // 56 Djanet
  { wilaya: 56, fr: 'Djanet', ar: 'جانت' },
  { wilaya: 56, fr: 'Bordj El Haouas', ar: 'برج الحواس' },

  // 57 In Salah
  { wilaya: 57, fr: 'In Salah', ar: 'عين صالح' },
  { wilaya: 57, fr: 'In Ghar', ar: 'عين غار' },
  { wilaya: 57, fr: 'Foggaret Ezzoua', ar: 'فقارة الزوى' },

  // 58 In Guezzam
  { wilaya: 58, fr: 'In Guezzam', ar: 'عين قزام' },
  { wilaya: 58, fr: 'Tin Zaouatine', ar: 'تين زواتين' },
];
