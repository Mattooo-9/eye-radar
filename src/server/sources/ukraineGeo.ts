import { isPointInPolygon, UKRAINE_BORDER_POLYGON } from "../domain/geo.js";

export interface GeoPoint {
  name: string;
  nameUk: string;
  lat: number;
  lon: number;
  oblast?: string;
  type?: "city" | "town" | "border_entry" | "region";
  aliases?: string[];
  isRegion?: boolean;
  isFrontline?: boolean;
}

export const UKRAINE_CITIES: Record<string, GeoPoint> = {
  // Oblast centers and major cities
  kyiv: { name: "Kyiv", nameUk: "Київ", lat: 50.4501, lon: 30.5234, oblast: "Kyiv", aliases: ["київ", "києва", "києву", "києві", "киев", "киева", "киеву", "киеве"] },
  kharkiv: { name: "Kharkiv", nameUk: "Харків", lat: 49.9935, lon: 36.2304, oblast: "Kharkiv", isFrontline: true, aliases: ["харків", "харкова", "харкову", "харьков", "харькова", "харькову"] },
  odesa: { name: "Odesa", nameUk: "Одеса", lat: 46.4825, lon: 30.7233, oblast: "Odesa", aliases: ["одеса", "одесу", "одеси", "одесі", "одесса", "одессу", "одессы"] },
  dnipro: { name: "Dnipro", nameUk: "Дніпро", lat: 48.4647, lon: 35.0462, oblast: "Dnipropetrovsk", aliases: ["дніпро", "дніпра", "дніпру", "днепр", "днепра", "днепру"] },
  zaporizhzhia: { name: "Zaporizhzhia", nameUk: "Запоріжжя", lat: 47.8388, lon: 35.1396, oblast: "Zaporizhzhia", isFrontline: true, aliases: ["запоріжжя", "запоріжжю", "запорожье", "запорожья", "запорожью"] },
  lviv: { name: "Lviv", nameUk: "Львів", lat: 49.8397, lon: 24.0297, oblast: "Lviv", aliases: ["львів", "львова", "львову", "львов", "львова", "львову"] },
  kryvyirih: { name: "Kryvyi Rih", nameUk: "Кривий Ріг", lat: 47.9105, lon: 33.3918, oblast: "Dnipropetrovsk", aliases: ["кривий ріг", "кривого рогу", "кривому рогу", "кривой рог", "кривого рога"] },
  mykolaiv: { name: "Mykolaiv", nameUk: "Миколаїв", lat: 46.975, lon: 31.9946, oblast: "Mykolaiv", aliases: ["миколаїв", "миколаєва", "миколаєву", "николаев", "николаева", "николаеву"] },
  mariupol: { name: "Mariupol", nameUk: "Маріуполь", lat: 47.0951, lon: 37.5494, oblast: "Donetsk", isFrontline: true, aliases: ["маріуполь", "маріуполя", "мариуполь"] },
  luhansk: { name: "Luhansk", nameUk: "Луганськ", lat: 48.574, lon: 39.3078, oblast: "Luhansk", isFrontline: true, aliases: ["луганськ", "луганск"] },
  donetsk: { name: "Donetsk", nameUk: "Донецьк", lat: 48.0159, lon: 37.8029, oblast: "Donetsk", isFrontline: true, aliases: ["донецьк", "донецк"] },
  kherson: { name: "Kherson", nameUk: "Херсон", lat: 46.6354, lon: 32.6169, oblast: "Kherson", isFrontline: true, aliases: ["херсон", "херсона", "херсону"] },
  vinnytsia: { name: "Vinnytsia", nameUk: "Вінниця", lat: 49.2331, lon: 28.4682, oblast: "Vinnytsia", aliases: ["вінниця", "вінницю", "вінниці", "винница", "винницу"] },
  poltava: { name: "Poltava", nameUk: "Полтава", lat: 49.5883, lon: 34.5514, oblast: "Poltava", aliases: ["полтава", "полтаву", "полтави", "полтаве"] },
  chernihiv: { name: "Chernihiv", nameUk: "Чернігів", lat: 51.4982, lon: 31.2893, oblast: "Chernihiv", aliases: ["чернігів", "чернігова", "чернигов", "чернигова"] },
  cherkasy: { name: "Cherkasy", nameUk: "Черкаси", lat: 49.4444, lon: 32.0598, oblast: "Cherkasy", aliases: ["черкаси", "черкас", "черкасам", "черкассы"] },
  zhytomyr: { name: "Zhytomyr", nameUk: "Житомир", lat: 50.2547, lon: 28.6587, oblast: "Zhytomyr", aliases: ["житомир", "житомира", "житомиру"] },
  sumy: { name: "Sumy", nameUk: "Суми", lat: 50.9077, lon: 34.7981, oblast: "Sumy", isFrontline: true, aliases: ["суми", "сумам", "сумах", "сумы", "суммы"] },
  khmelnytskyi: { name: "Khmelnytskyi", nameUk: "Хмельницький", lat: 49.423, lon: 26.9871, oblast: "Khmelnytskyi", aliases: ["хмельницький", "хмельницького", "хмельницкий"] },
  chernivtsi: { name: "Chernivtsi", nameUk: "Чернівці", lat: 48.2917, lon: 25.9352, oblast: "Chernivtsi", aliases: ["чернівці", "чернівців", "черновцы"] },
  rivne: { name: "Rivne", nameUk: "Рівне", lat: 50.6199, lon: 26.2516, oblast: "Rivne", aliases: ["рівне", "рівного", "ровно"] },
  kamianske: { name: "Kamianske", nameUk: "Кам'янське", lat: 48.5144, lon: 34.6152, oblast: "Dnipropetrovsk", aliases: ["кам'янське", "кам'янського", "каменское"] },
  kropyvnytskyi: { name: "Kropyvnytskyi", nameUk: "Кропивницький", lat: 48.5079, lon: 32.2623, oblast: "Kirovohrad", aliases: ["кропивницький", "кропивницького", "кропивницкий"] },
  ivanofrankivsk: { name: "Ivano-Frankivsk", nameUk: "Івано-Франківськ", lat: 48.9226, lon: 24.7111, oblast: "Ivano-Frankivsk", aliases: ["івано-франківськ", "франківськ", "ивано-франковск"] },
  kremenchuk: { name: "Kremenchuk", nameUk: "Кременчук", lat: 49.063, lon: 33.404, oblast: "Poltava", aliases: ["кременчук", "кременчука", "кременчуга"] },
  ternopil: { name: "Ternopil", nameUk: "Тернопіль", lat: 49.5535, lon: 25.5948, oblast: "Ternopil", aliases: ["тернопіль", "тернополя", "тернополь"] },
  lutsk: { name: "Lutsk", nameUk: "Луцьк", lat: 50.7472, lon: 25.3254, oblast: "Volyn", aliases: ["луцьк", "луцька", "луцк"] },
  bila_tserkva: { name: "Bila Tserkva", nameUk: "Біла Церква", lat: 49.7989, lon: 30.1153, oblast: "Kyiv", aliases: ["біла церква", "білої церкви", "белая церковь"] },
  uzhhorod: { name: "Uzhhorod", nameUk: "Ужгород", lat: 48.6208, lon: 22.2879, oblast: "Zakarpattia", aliases: ["ужгород", "ужгорода"] },

  // Key regional & frontline air-defense towns
  nikopol: { name: "Nikopol", nameUk: "Нікополь", lat: 47.5756, lon: 34.3847, oblast: "Dnipropetrovsk", isFrontline: true, aliases: ["нікополь", "нікополя", "никополь"] },
  slovyansk: { name: "Slovyansk", nameUk: "Слов'янськ", lat: 48.8532, lon: 37.625, oblast: "Donetsk", isFrontline: true, aliases: ["слов'янськ", "славянск"] },
  kramatorsk: { name: "Kramatorsk", nameUk: "Краматорськ", lat: 48.7389, lon: 37.5844, oblast: "Donetsk", isFrontline: true, aliases: ["краматорськ", "краматорск"] },
  pokrovsk: { name: "Pokrovsk", nameUk: "Покровськ", lat: 48.282, lon: 37.175, oblast: "Donetsk", isFrontline: true, aliases: ["покровськ", "покровск"] },
  dobropillia: { name: "Dobropillia", nameUk: "Добропілля", lat: 48.469, lon: 37.082, oblast: "Donetsk", isFrontline: true, aliases: ["добропілля", "доброполье"] },
  druzhkivka: { name: "Druzhkivka", nameUk: "Дружківка", lat: 48.618, lon: 37.528, oblast: "Donetsk", isFrontline: true, aliases: ["дружківка", "дружковка"] },
  kostiantynivka: { name: "Kostiantynivka", nameUk: "Костянтинівка", lat: 48.528, lon: 37.707, oblast: "Donetsk", isFrontline: true, aliases: ["костянтинівка", "константиновка"] },
  lyman: { name: "Lyman", nameUk: "Лиман", lat: 48.985, lon: 37.805, oblast: "Donetsk", isFrontline: true, aliases: ["лиман", "лимана"] },
  pavlohrad: { name: "Pavlohrad", nameUk: "Павлоград", lat: 48.5299, lon: 35.8711, oblast: "Dnipropetrovsk", aliases: ["павлоград", "павлограда"] },
  konotop: { name: "Konotop", nameUk: "Конотоп", lat: 51.242, lon: 33.2037, oblast: "Sumy", aliases: ["конотоп", "конотопа"] },
  shostka: { name: "Shostka", nameUk: "Шостка", lat: 51.8631, lon: 33.4862, oblast: "Sumy", aliases: ["шостка", "шостку", "шостки"] },
  uman: { name: "Uman", nameUk: "Умань", lat: 48.7484, lon: 30.2218, oblast: "Cherkasy", aliases: ["умань", "умані"] },
  izmail: { name: "Izmail", nameUk: "Ізмаїл", lat: 45.3507, lon: 28.8398, oblast: "Odesa", aliases: ["ізмаїл", "ізмаїла", "измаил"] },
  chornomorsk: { name: "Chornomorsk", nameUk: "Чорноморськ", lat: 46.2996, lon: 30.6558, oblast: "Odesa", aliases: ["чорноморськ", "черноморск"] },
  brovary: { name: "Brovary", nameUk: "Бровари", lat: 50.5113, lon: 30.7901, oblast: "Kyiv", aliases: ["бровари", "броварів", "бровары"] },
  boryspil: { name: "Boryspil", nameUk: "Бориспіль", lat: 50.3544, lon: 30.9554, oblast: "Kyiv", aliases: ["бориспіль", "борисполя", "борисполь"] },
  troieshchyna: { name: "Troieshchyna", nameUk: "Троєщина", lat: 50.514, lon: 30.612, oblast: "Kyiv", aliases: ["троєщина", "троєщину", "троещина", "троещину"] },
  irpin: { name: "Irpin", nameUk: "Ірпінь", lat: 50.5186, lon: 30.2396, oblast: "Kyiv", aliases: ["ірпінь", "ірпеня", "ирпень"] },
  starokostiantyniv: { name: "Starokostiantyniv", nameUk: "Старокостянтинів", lat: 49.7562, lon: 27.2212, oblast: "Khmelnytskyi", aliases: ["старокостянтинів", "староконстантинов"] },
  myrhorod: { name: "Myrhorod", nameUk: "Миргород", lat: 49.967, lon: 33.6074, oblast: "Poltava", aliases: ["миргород", "миргорода"] },
  pryluky: { name: "Pryluky", nameUk: "Прилуки", lat: 50.5908, lon: 32.3874, oblast: "Chernihiv", aliases: ["прилуки", "прилук"] },
  nizhyn: { name: "Nizhyn", nameUk: "Ніжин", lat: 51.0483, lon: 31.8864, oblast: "Chernihiv", aliases: ["ніжин", "ніжина", "нежин"] },
  korosten: { name: "Korosten", nameUk: "Коростень", lat: 50.9507, lon: 28.6473, oblast: "Zhytomyr", aliases: ["коростень", "коростеня"] },
  berdychiv: { name: "Berdychiv", nameUk: "Бердичів", lat: 49.8937, lon: 28.5878, oblast: "Zhytomyr", aliases: ["бердичів", "бердичева", "бердичев"] },
  ochakiv: { name: "Ochakiv", nameUk: "Очаків", lat: 46.6139, lon: 31.5492, oblast: "Mykolaiv", isFrontline: true, aliases: ["очаків", "очакова", "очаков"] },
  voznesensk: { name: "Voznesensk", nameUk: "Вознесенськ", lat: 47.5628, lon: 31.3323, oblast: "Mykolaiv", aliases: ["вознесенськ", "вознесенська", "вознесенск"] },
  berezanka: { name: "Berezanka", nameUk: "Березанка", lat: 46.854, lon: 31.389, oblast: "Mykolaiv", aliases: ["березанка", "березанку", "березанки"] },
  snihurivka: { name: "Snihurivka", nameUk: "Снігурівка", lat: 47.071, lon: 32.805, oblast: "Mykolaiv", isFrontline: true, aliases: ["снігурівка", "снігурівку", "снегиревка"] },
  bashtanka: { name: "Bashtanka", nameUk: "Баштанка", lat: 47.405, lon: 32.439, oblast: "Mykolaiv", aliases: ["баштанка", "баштанку"] },
  shepetivka: { name: "Shepetivka", nameUk: "Шепетівка", lat: 50.1834, lon: 27.0617, oblast: "Khmelnytskyi", aliases: ["шепетівка", "шепетівку", "шепетовка"] },

  // Kharkiv frontline & raion towns (tlknewsua / kpszsu)
  chuhuiv: { name: "Chuhuiv", nameUk: "Чугуїв", lat: 49.8356, lon: 36.6853, oblast: "Kharkiv", isFrontline: true, aliases: ["чугуїв", "чугуєва", "чугуев"] },
  izium: { name: "Izium", nameUk: "Ізюм", lat: 49.1927, lon: 37.2847, oblast: "Kharkiv", isFrontline: true, aliases: ["ізюм", "ізюма", "изюм"] },
  kupiansk: { name: "Kupiansk", nameUk: "Куп'янськ", lat: 49.7126, lon: 37.6186, oblast: "Kharkiv", isFrontline: true, aliases: ["куп'янськ", "куп'янська", "купянск", "купянска"] },
  derhachi: { name: "Derhachi", nameUk: "Дергачі", lat: 50.111, lon: 36.119, oblast: "Kharkiv", isFrontline: true, aliases: ["дергачі", "дергачів", "дергачи", "дергачей"] },
  shevchenkove: { name: "Shevchenkove", nameUk: "Шевченкове", lat: 49.696, lon: 37.177, oblast: "Kharkiv", isFrontline: true, aliases: ["шевченкове", "шевченково", "шевченкового"] },
  vilshany: { name: "Vilshany", nameUk: "Вільшани", lat: 50.056, lon: 35.887, oblast: "Kharkiv", isFrontline: true, aliases: ["вільшани", "ольшаны"] },
  peresichne: { name: "Peresichne", nameUk: "Пересічне", lat: 50.023, lon: 35.973, oblast: "Kharkiv", isFrontline: true, aliases: ["пересічне", "пересечное"] },
  chornohlazivka: { name: "Chornohlazivka", nameUk: "Чорноглазівка", lat: 50.194, lon: 35.847, oblast: "Kharkiv", isFrontline: true, aliases: ["чорноглазівка", "чорноглазівку", "черноглазовка", "черноглазовку"] },
  zolochiv: { name: "Zolochiv", nameUk: "Золочів", lat: 50.281, lon: 35.979, oblast: "Kharkiv", isFrontline: true, aliases: ["золочів", "золочев"] },
  lozova: { name: "Lozova", nameUk: "Лозова", lat: 48.889, lon: 36.318, oblast: "Kharkiv", aliases: ["лозова", "лозову", "лозовая"] },
  balakliia: { name: "Balakliia", nameUk: "Балаклія", lat: 49.458, lon: 36.858, oblast: "Kharkiv", isFrontline: true, aliases: ["балаклія", "балаклію", "балаклея"] },
  bohodukhiv: { name: "Bohodukhiv", nameUk: "Богодухів", lat: 50.163, lon: 35.524, oblast: "Kharkiv", isFrontline: true, aliases: ["богодухів", "богодухов"] },
  vovchansk: { name: "Vovchansk", nameUk: "Вовчанськ", lat: 50.288, lon: 36.942, oblast: "Kharkiv", isFrontline: true, aliases: ["вовчанськ", "волчанск"] },
  orilka: { name: "Orilka", nameUk: "Орілька", lat: 48.969, lon: 36.026, oblast: "Kharkiv", aliases: ["орілька", "орільку", "орелька"] },
  zachepylivka: { name: "Zachepylivka", nameUk: "Зачепилівка", lat: 49.193, lon: 35.242, oblast: "Kharkiv", aliases: ["зачепилівка", "зачепилівку", "зачепиловка"] },
  barvinkove: { name: "Barvinkove", nameUk: "Барвінкове", lat: 48.905, lon: 37.022, oblast: "Kharkiv", isFrontline: true, aliases: ["барвінкове", "барвенково"] },
  krasnopavlivka: { name: "Krasnopavlivka", nameUk: "Краснопавлівка", lat: 49.138, lon: 36.326, oblast: "Kharkiv", aliases: ["краснопавлівка", "краснопавлівку", "краснопавловка"] },
  orativ: { name: "Orativ", nameUk: "Оратів", lat: 49.188, lon: 29.527, oblast: "Vinnytsia", aliases: ["оратів", "оратова", "оратов"] },
  lypovets: { name: "Lypovets", nameUk: "Липовець", lat: 49.217, lon: 29.055, oblast: "Vinnytsia", aliases: ["липовець", "липовця", "липовец"] },
  teplyk: { name: "Teplyk", nameUk: "Теплик", lat: 48.662, lon: 29.746, oblast: "Vinnytsia", aliases: ["теплик", "теплика"] },
  haivoron: { name: "Haivoron", nameUk: "Гайворон", lat: 48.340, lon: 29.866, oblast: "Kirovohrad", aliases: ["гайворон", "гайворона"] },
  borova: { name: "Borova", nameUk: "Борова", lat: 49.376, lon: 37.622, oblast: "Kharkiv", isFrontline: true, aliases: ["борова", "борову"] },
  khotimlia: { name: "Khotimlia", nameUk: "Хотімля", lat: 50.017, lon: 36.875, oblast: "Kharkiv", isFrontline: true, aliases: ["хотімля", "хотімлю", "хотомля"] },

  // Dnipropetrovsk & Kirovohrad tactical towns
  lozuvatka: { name: "Lozuvatka", nameUk: "Лозуватка", lat: 48.054, lon: 33.289, oblast: "Dnipropetrovsk", aliases: ["лозуватка", "лозуватку"] },
  piatykhatky: { name: "Piatykhatky", nameUk: "П'ятихатки", lat: 48.414, lon: 33.702, oblast: "Dnipropetrovsk", aliases: ["п'ятихатки", "пятихатки", "пʼятихатки"] },
  vasylkivka: { name: "Vasylkivka", nameUk: "Васильківка", lat: 48.204, lon: 36.021, oblast: "Dnipropetrovsk", aliases: ["васильківка", "васильківку", "васильковка"] },
  marhanets: { name: "Marhanets", nameUk: "Марганець", lat: 47.645, lon: 34.604, oblast: "Dnipropetrovsk", isFrontline: true, aliases: ["марганець", "марганця", "марганец"] },
  pidhorodne: { name: "Pidhorodne", nameUk: "Підгороднє", lat: 48.575, lon: 35.107, oblast: "Dnipropetrovsk", aliases: ["підгороднє", "подгородное"] },
  yuriivka: { name: "Yuriivka", nameUk: "Юріївка", lat: 48.738, lon: 36.017, oblast: "Dnipropetrovsk", aliases: ["юріївка", "юріївку", "юрьевка"] },
  slavhorod: { name: "Slavhorod", nameUk: "Славгород", lat: 48.299, lon: 35.512, oblast: "Dnipropetrovsk", aliases: ["славгород", "славгорода"] },
  vilnohirsk: { name: "Vilnohirsk", nameUk: "Вільногірськ", lat: 48.478, lon: 34.028, oblast: "Dnipropetrovsk", aliases: ["вільногірськ", "вольногорск"] },
  samar: { name: "Samar", nameUk: "Самар", lat: 48.634, lon: 35.228, oblast: "Dnipropetrovsk", aliases: ["на самар", "самар", "новомосковськ", "новомосковск"] },
  synelnykove: { name: "Synelnykove", nameUk: "Синельникове", lat: 48.324, lon: 35.518, oblast: "Dnipropetrovsk", aliases: ["синельникове", "синельниково"] },
  apostolove: { name: "Apostolove", nameUk: "Апостолове", lat: 47.659, lon: 33.717, oblast: "Dnipropetrovsk", aliases: ["апостолове", "апостолово"] },
  mezhova: { name: "Mezhova", nameUk: "Межова", lat: 48.255, lon: 36.736, oblast: "Dnipropetrovsk", isFrontline: true, aliases: ["межова", "межову"] },
  dolynska: { name: "Dolynska", nameUk: "Долинська", lat: 48.111, lon: 32.765, oblast: "Kirovohrad", aliases: ["долинська", "долинську", "долинская"] },
  oleksandriia: { name: "Oleksandriia", nameUk: "Олександрія", lat: 48.670, lon: 33.116, oblast: "Kirovohrad", aliases: ["олександрія", "олександрію", "александрия"] },
  svitlovodsk: { name: "Svitlovodsk", nameUk: "Світловодськ", lat: 49.049, lon: 33.229, oblast: "Kirovohrad", aliases: ["світловодськ", "светловодск"] },
  znamianka: { name: "Znamianka", nameUk: "Знам'янка", lat: 48.712, lon: 32.673, oblast: "Kirovohrad", aliases: ["знам'янка", "знам'янку", "знаменка"] },

  // Poltava, Chernihiv, Zhytomyr, Kyiv, Rivne, Zaporizhzhia, Cherkasy, Vinnytsia, Odesa towns
  khorol: { name: "Khorol", nameUk: "Хорол", lat: 49.786, lon: 33.268, oblast: "Poltava", aliases: ["хорол", "хорола"] },
  kozelschyna: { name: "Kozelschyna", nameUk: "Козельщина", lat: 49.217, lon: 33.841, oblast: "Poltava", aliases: ["козельщина", "козельщину"] },
  kobeliaky: { name: "Kobeliaky", nameUk: "Кобеляки", lat: 49.141, lon: 34.197, oblast: "Poltava", aliases: ["кобеляки", "кобеляк"] },
  reshetylivka: { name: "Reshetylivka", nameUk: "Решетилівка", lat: 49.566, lon: 34.069, oblast: "Poltava", aliases: ["решетилівка", "решетилівку", "решетиловка"] },
  lubny: { name: "Lubny", nameUk: "Лубни", lat: 50.017, lon: 32.985, oblast: "Poltava", aliases: ["лубни", "лубен", "лубны"] },
  pyriatyn: { name: "Pyriatyn", nameUk: "Пирятин", lat: 50.245, lon: 32.508, oblast: "Poltava", aliases: ["пирятин", "пирятина"] },
  ovruch: { name: "Ovruch", nameUk: "Овруч", lat: 51.322, lon: 28.802, oblast: "Zhytomyr", aliases: ["овруч", "овруча"] },
  holovyne: { name: "Holovyne", nameUk: "Головине", lat: 50.470, lon: 28.842, oblast: "Zhytomyr", aliases: ["головине", "головино"] },
  potiivka: { name: "Potiivka", nameUk: "Потіївка", lat: 50.619, lon: 28.972, oblast: "Zhytomyr", aliases: ["потіївка", "потіївку"] },
  brusyliv: { name: "Brusyliv", nameUk: "Брусилів", lat: 50.285, lon: 29.524, oblast: "Zhytomyr", aliases: ["брусилів", "брусилова", "брусилов"] },
  malyn: { name: "Malyn", nameUk: "Малін", lat: 50.768, lon: 29.240, oblast: "Zhytomyr", aliases: ["малін", "малин"] },
  radomyshl: { name: "Radomyshl", nameUk: "Радомишль", lat: 50.493, lon: 29.231, oblast: "Zhytomyr", aliases: ["радомишль"] },
  zvyahel: { name: "Zvyahel", nameUk: "Звягель", lat: 50.583, lon: 27.633, oblast: "Zhytomyr", aliases: ["звягель"] },
  olevsk: { name: "Olevsk", nameUk: "Олевськ", lat: 51.225, lon: 27.649, oblast: "Zhytomyr", aliases: ["олевськ", "олевск"] },
  sarny: { name: "Sarny", nameUk: "Сарни", lat: 51.338, lon: 26.602, oblast: "Rivne", aliases: ["сарни", "сарны"] },
  varash: { name: "Varash", nameUk: "Вараш", lat: 51.343, lon: 25.852, oblast: "Rivne", aliases: ["вараш"] },
  dubno: { name: "Dubno", nameUk: "Дубно", lat: 50.419, lon: 25.736, oblast: "Rivne", aliases: ["дубно"] },
  slavutych: { name: "Slavutych", nameUk: "Славутич", lat: 51.520, lon: 30.757, oblast: "Chernihiv", aliases: ["славутич", "славутича"] },
  horodnia: { name: "Horodnia", nameUk: "Городня", lat: 51.891, lon: 31.594, oblast: "Chernihiv", aliases: ["городня", "городню", "городни"] },
  berezna: { name: "Berezna", nameUk: "Березна", lat: 51.572, lon: 31.785, oblast: "Chernihiv", aliases: ["березна", "березну"] },
  horodnya_bakhmach: { name: "Bakhmach", nameUk: "Бахмач", lat: 51.181, lon: 32.828, oblast: "Chernihiv", aliases: ["бахмач", "бахмача"] },
  chornobyl: { name: "Chornobyl", nameUk: "Чорнобиль", lat: 51.276, lon: 30.222, oblast: "Kyiv", aliases: ["чорнобиль", "чорнобиля", "чернобыль"] },
  chaes: { name: "ChAES", nameUk: "ЧАЕС", lat: 51.389, lon: 30.099, oblast: "Kyiv", aliases: ["чаес", "чорнобильської аес"] },
  krasiatychi: { name: "Krasiatychi", nameUk: "Красятичі", lat: 51.076, lon: 29.634, oblast: "Kyiv", aliases: ["красятичі", "красятич"] },
  skvyra: { name: "Skvyra", nameUk: "Сквира", lat: 49.732, lon: 29.664, oblast: "Kyiv", aliases: ["сквира", "сквиру"] },
  vasylkiv: { name: "Vasylkiv", nameUk: "Васильків", lat: 50.179, lon: 30.317, oblast: "Kyiv", aliases: ["васильків", "васильков"] },
  obukhiv: { name: "Obukhiv", nameUk: "Обухів", lat: 50.125, lon: 30.630, oblast: "Kyiv", aliases: ["обухів", "обухов"] },
  fastiv: { name: "Fastiv", nameUk: "Фастів", lat: 50.078, lon: 29.919, oblast: "Kyiv", aliases: ["фастів", "фастов"] },
  hostomel: { name: "Hostomel", nameUk: "Гостомель", lat: 50.569, lon: 30.265, oblast: "Kyiv", aliases: ["гостомель", "гостомеля"] },
  dymer: { name: "Dymer", nameUk: "Димер", lat: 50.781, lon: 30.309, oblast: "Kyiv", aliases: ["димер", "дымер"] },
  vyshhorod: { name: "Vyshhorod", nameUk: "Вишгород", lat: 50.584, lon: 30.490, oblast: "Kyiv", aliases: ["вишгород", "вышгород"] },
  bucha: { name: "Bucha", nameUk: "Буча", lat: 50.548, lon: 30.221, oblast: "Kyiv", aliases: ["буча", "бучу"] },
  makariv: { name: "Makariv", nameUk: "Макарів", lat: 50.463, lon: 29.813, oblast: "Kyiv", aliases: ["макарів", "макаров"] },
  piskivka: { name: "Piskivka", nameUk: "Пісківка", lat: 50.707, lon: 29.595, oblast: "Kyiv", aliases: ["пісківка", "пісківку", "песковка"] },
  mayaky: { name: "Mayaky", nameUk: "Маяки", lat: 46.415, lon: 30.274, oblast: "Odesa", aliases: ["маяки"] },
  zakharivka: { name: "Zakharivka", nameUk: "Захарівка", lat: 47.332, lon: 29.756, oblast: "Odesa", aliases: ["захарівка", "захарівку", "захаровка"] },
  bilhorod_dnistrovskyi: { name: "Bilhorod-Dnistrovskyi", nameUk: "Білгород-Дністровський", lat: 46.192, lon: 30.344, oblast: "Odesa", aliases: ["білгород-дністровський", "белгород-днестровский"] },
  yuzhne: { name: "Yuzhne", nameUk: "Южне", lat: 46.622, lon: 31.101, oblast: "Odesa", aliases: ["южне", "південне"] },
  podilsk: { name: "Podilsk", nameUk: "Подільськ", lat: 47.742, lon: 29.534, oblast: "Odesa", aliases: ["подільськ", "подольск"] },
  zvenyhorodka: { name: "Zvenyhorodka", nameUk: "Звенигородка", lat: 49.071, lon: 30.967, oblast: "Cherkasy", aliases: ["звенигородка", "звенигородки"] },
  smila: { name: "Smila", nameUk: "Сміла", lat: 49.219, lon: 31.873, oblast: "Cherkasy", aliases: ["сміла", "смілу", "смела"] },
  zolotonosha: { name: "Zolotonosha", nameUk: "Золотоноша", lat: 49.670, lon: 32.040, oblast: "Cherkasy", aliases: ["золотоноша", "золотоношу"] },
  kaniv: { name: "Kaniv", nameUk: "Канів", lat: 49.753, lon: 31.460, oblast: "Cherkasy", aliases: ["канів", "канев"] },
  korsun: { name: "Korsun", nameUk: "Корсунь", lat: 49.428, lon: 31.280, oblast: "Cherkasy", aliases: ["корсунь"] },
  okhtyrka: { name: "Okhtyrka", nameUk: "Охтирка", lat: 50.311, lon: 34.898, oblast: "Sumy", isFrontline: true, aliases: ["охтирка", "охтирку", "ахтырка"] },
  romny: { name: "Romny", nameUk: "Ромни", lat: 50.748, lon: 33.475, oblast: "Sumy", aliases: ["ромни", "ромны"] },
  hlukhiv: { name: "Hlukhiv", nameUk: "Глухів", lat: 51.677, lon: 33.916, oblast: "Sumy", isFrontline: true, aliases: ["глухів", "глухов"] },
  lebedyn: { name: "Lebedyn", nameUk: "Лебедин", lat: 50.582, lon: 34.481, oblast: "Sumy", aliases: ["лебедин"] },
  kovel: { name: "Kovel", nameUk: "Ковель", lat: 51.217, lon: 24.717, oblast: "Volyn", aliases: ["ковель"] },
  volodymyr: { name: "Volodymyr", nameUk: "Володимир", lat: 50.852, lon: 24.322, oblast: "Volyn", aliases: ["володимир"] },
  netishyn: { name: "Netishyn", nameUk: "Нетішин", lat: 50.334, lon: 26.650, oblast: "Khmelnytskyi", aliases: ["нетішин", "нетешин"] },
  slavuta: { name: "Slavuta", nameUk: "Славута", lat: 50.299, lon: 26.868, oblast: "Khmelnytskyi", aliases: ["славута", "славуту"] },
  ladyzhyn: { name: "Ladyzhyn", nameUk: "Ладижин", lat: 48.692, lon: 29.243, oblast: "Vinnytsia", aliases: ["ладижин", "ладыжин"] },
  zhmerynka: { name: "Zhmerynka", nameUk: "Жмеринка", lat: 49.037, lon: 28.109, oblast: "Vinnytsia", aliases: ["жмеринка", "жмеринку"] },
  koziatyn: { name: "Koziatyn", nameUk: "Козятин", lat: 49.718, lon: 28.835, oblast: "Vinnytsia", aliases: ["козятин", "казатин"] },
  haisyn: { name: "Haisyn", nameUk: "Гайсин", lat: 48.810, lon: 29.387, oblast: "Vinnytsia", aliases: ["гайсин"] },
  mohyliv_podilskyi: { name: "Mohyliv-Podilskyi", nameUk: "Могилів-Подільський", lat: 48.455, lon: 27.797, oblast: "Vinnytsia", aliases: ["могилів-подільський", "могилев-подольский"] },
  vilniansk: { name: "Vilniansk", nameUk: "Вільнянськ", lat: 47.943, lon: 35.432, oblast: "Zaporizhzhia", isFrontline: true, aliases: ["вільнянськ", "вольнянск"] },
  orikhiv: { name: "Orikhiv", nameUk: "Оріхів", lat: 47.568, lon: 35.786, oblast: "Zaporizhzhia", isFrontline: true, aliases: ["оріхів", "орехов"] },
  huliaipole: { name: "Huliaipole", nameUk: "Гуляйполе", lat: 47.662, lon: 36.258, oblast: "Zaporizhzhia", isFrontline: true, aliases: ["гуляйполе"] },
  novomykolaivka: { name: "Novomykolaivka", nameUk: "Новомиколаївка", lat: 47.977, lon: 35.910, oblast: "Zaporizhzhia", isFrontline: true, aliases: ["новомиколаївка", "новомиколаївку", "новониколаевка"] },
  komyshuvakha: { name: "Komyshuvakha", nameUk: "Комишуваха", lat: 47.716, lon: 35.515, oblast: "Zaporizhzhia", isFrontline: true, aliases: ["комишуваха", "комишуваху", "камышеваха"] },
  stepnohirsk: { name: "Stepnohirsk", nameUk: "Степногірськ", lat: 47.589, lon: 35.360, oblast: "Zaporizhzhia", isFrontline: true, aliases: ["степногірськ", "степногорск"] },
  kazanka: { name: "Kazanka", nameUk: "Казанка", lat: 47.840, lon: 32.828, oblast: "Mykolaiv", aliases: ["казанка", "казанку", "казанки"] },
  novyi_buh: { name: "Novyi Buh", nameUk: "Новий Буг", lat: 47.685, lon: 32.515, oblast: "Mykolaiv", aliases: ["новий буг", "нового бугу"] },
  veselynove: { name: "Veselynove", nameUk: "Веселинове", lat: 47.358, lon: 31.236, oblast: "Mykolaiv", aliases: ["веселинове", "веселиново"] },
  domanivka: { name: "Domanivka", nameUk: "Доманівка", lat: 47.628, lon: 30.985, oblast: "Mykolaiv", aliases: ["доманівка", "доманівку"] },
  yelanets: { name: "Yelanets", nameUk: "Єланець", lat: 47.698, lon: 31.855, oblast: "Mykolaiv", aliases: ["єланець", "єланця"] },
  shyroke: { name: "Shyroke", nameUk: "Широке", lat: 47.690, lon: 33.260, oblast: "Dnipropetrovsk", aliases: ["широке", "широкого"] },
  sofiivka: { name: "Sofiivka", nameUk: "Софіївка", lat: 48.055, lon: 33.868, oblast: "Dnipropetrovsk", aliases: ["софіївка", "софіївку", "софиевка"] },
  pokrovske: { name: "Pokrovske", nameUk: "Покровське", lat: 47.982, lon: 36.235, oblast: "Dnipropetrovsk", isFrontline: true, aliases: ["покровське", "покровського"] },
  mahdalynivka: { name: "Mahdalynivka", nameUk: "Магдалинівка", lat: 48.920, lon: 34.918, oblast: "Dnipropetrovsk", aliases: ["магдалинівка", "магдалинівку"] },
  pereshchepyne: { name: "Pereshchepyne", nameUk: "Перещепине", lat: 49.013, lon: 35.365, oblast: "Dnipropetrovsk", aliases: ["перещепине", "перещепино"] },
  pervomaisk: { name: "Pervomaisk", nameUk: "Первомайськ", lat: 48.044, lon: 30.850, oblast: "Mykolaiv", aliases: ["первомайськ", "первомайск"] },
  yuzhnoukrainsk: { name: "Yuzhnoukrainsk", nameUk: "Южноукраїнськ", lat: 47.822, lon: 31.176, oblast: "Mykolaiv", aliases: ["южноукраїнськ", "південноукраїнськ", "южноукраинск"] },
  liubotyn: { name: "Liubotyn", nameUk: "Люботин", lat: 49.948, lon: 35.932, oblast: "Kharkiv", isFrontline: true, aliases: ["люботин", "люботина", "люботину"] },
  bilenke: { name: "Bilenke", nameUk: "Біленьке", lat: 47.624, lon: 35.041, oblast: "Zaporizhzhia", isFrontline: true, aliases: ["біленьке", "біленького", "беленькое"] },
  tavriiske: { name: "Tavriiske", nameUk: "Таврійське", lat: 47.648, lon: 35.721, oblast: "Zaporizhzhia", isFrontline: true, aliases: ["таврійське", "таврійського", "таврийское"] },
  zelenodolsk: { name: "Zelenodolsk", nameUk: "Зеленодольськ", lat: 47.564, lon: 33.647, oblast: "Dnipropetrovsk", aliases: ["зеленодольськ", "зеленодольська", "зеленодольск"] },
  obolon: { name: "Obolon (Kyiv)", nameUk: "Оболонь", lat: 50.501, lon: 30.498, oblast: "Kyiv", aliases: ["оболонь", "оболоні", "оболони"] },
  desnianskyi: { name: "Desnianskyi (Kyiv)", nameUk: "Деснянський р-н", lat: 50.517, lon: 30.618, oblast: "Kyiv", aliases: ["деснянський", "деснянського", "деснянского", "деснянська тец", "деснянську тец"] },

  // Expanded high-precision coverage across all Ukrainian oblasts, frontline, & Black Sea approaches
  black_sea: { name: "Black Sea Approach", nameUk: "Чорне море", lat: 46.150, lon: 31.050, oblast: "Odesa", aliases: ["чорне море", "чорного моря", "чорним морем", "черное море", "черного моря", "з моря", "акваторія"] },
  zatoka: { name: "Zatoka", nameUk: "Затока", lat: 46.071, lon: 30.461, oblast: "Odesa", aliases: ["затока", "затоку", "затоки"] },
  koblevo: { name: "Koblevo", nameUk: "Коблеве", lat: 46.631, lon: 31.186, oblast: "Mykolaiv", aliases: ["коблеве", "коблево"] },
  kiliia: { name: "Kiliia", nameUk: "Кілія", lat: 45.455, lon: 29.263, oblast: "Odesa", aliases: ["кілія", "кілію", "килия"] },
  reni: { name: "Reni", nameUk: "Рені", lat: 45.457, lon: 28.271, oblast: "Odesa", aliases: ["рені", "рени"] },
  vylkove: { name: "Vylkove", nameUk: "Вилкове", lat: 45.399, lon: 29.593, oblast: "Odesa", aliases: ["вилкове", "вилково"] },
  bolhrad: { name: "Bolhrad", nameUk: "Болград", lat: 45.677, lon: 28.613, oblast: "Odesa", aliases: ["болград", "болграда"] },
  artsyz: { name: "Artsyz", nameUk: "Арциз", lat: 45.992, lon: 29.431, oblast: "Odesa", aliases: ["арциз", "арциза"] },
  tatarbunary: { name: "Tatarbunary", nameUk: "Татарбунари", lat: 45.847, lon: 29.615, oblast: "Odesa", aliases: ["татарбунари", "татарбунары"] },
  ovidiopol: { name: "Ovidiopol", nameUk: "Овідіополь", lat: 46.246, lon: 30.440, oblast: "Odesa", aliases: ["овідіополь", "овидиополь"] },
  rozdilna: { name: "Rozdilna", nameUk: "Роздільна", lat: 46.849, lon: 30.077, oblast: "Odesa", aliases: ["роздільна", "роздільну", "раздельная", "роздільнянський район"] },
  berezivka_od: { name: "Berezivka", nameUk: "Березівка", lat: 47.204, lon: 30.916, oblast: "Odesa", aliases: ["березівка", "березівку", "березівський район"] },
  vasylivka_zp: { name: "Vasylivka", nameUk: "Василівка", lat: 47.441, lon: 35.274, oblast: "Zaporizhzhia", isFrontline: true, aliases: ["василівка", "василівський район"] },
  polohy: { name: "Polohy", nameUk: "Пологи", lat: 47.479, lon: 36.253, oblast: "Zaporizhzhia", isFrontline: true, aliases: ["пологи", "пологівський район"] },
  volnovakha: { name: "Volnovakha", nameUk: "Волноваха", lat: 47.596, lon: 37.499, oblast: "Donetsk", isFrontline: true, aliases: ["волноваха", "волноваський район"] },
  chervonohryhorivka: { name: "Chervonohryhorivka", nameUk: "Червоногригорівка", lat: 47.625, lon: 34.536, oblast: "Dnipropetrovsk", isFrontline: true, aliases: ["червоногригорівка", "червоногригорівська територіальна громада"] },
  trostianets_sumy: { name: "Trostianets", nameUk: "Тростянець", lat: 50.481, lon: 34.965, oblast: "Sumy", isFrontline: true, aliases: ["тростянець", "тростянця", "тростянец"] },
  krolevets: { name: "Krolevets", nameUk: "Кролевець", lat: 51.552, lon: 33.376, oblast: "Sumy", aliases: ["кролевець", "кролевця", "кролевец"] },
  bilopillia: { name: "Bilopillia", nameUk: "Білопілля", lat: 51.147, lon: 34.303, oblast: "Sumy", isFrontline: true, aliases: ["білопілля", "белополье"] },
  vorozhba: { name: "Vorozhba", nameUk: "Ворожба", lat: 51.174, lon: 34.221, oblast: "Sumy", isFrontline: true, aliases: ["ворожба", "ворожбу"] },
  krasnopillia: { name: "Krasnopillia", nameUk: "Краснопілля", lat: 50.771, lon: 35.263, oblast: "Sumy", isFrontline: true, aliases: ["краснопілля", "краснополье"] },
  velyka_pysarivka: { name: "Velyka Pysarivka", nameUk: "Велика Писарівка", lat: 50.422, lon: 35.483, oblast: "Sumy", isFrontline: true, aliases: ["велика писарівка", "велику писарівку"] },
  khotin: { name: "Khotin", nameUk: "Хотінь", lat: 51.077, lon: 34.777, oblast: "Sumy", isFrontline: true, aliases: ["хотінь", "хотень"] },
  novhorod_siverskyi: { name: "Novhorod-Siverskyi", nameUk: "Новгород-Сіверський", lat: 52.008, lon: 33.274, oblast: "Chernihiv", isFrontline: true, aliases: ["новгород-сіверський", "новгород-северский"] },
  koriukivka: { name: "Koriukivka", nameUk: "Корюківка", lat: 51.773, lon: 32.251, oblast: "Chernihiv", aliases: ["корюківка", "корюківку", "корюковка"] },
  mena: { name: "Mena", nameUk: "Мена", lat: 51.522, lon: 32.216, oblast: "Chernihiv", aliases: ["мена", "мену"] },
  borzna: { name: "Borzna", nameUk: "Борзна", lat: 51.255, lon: 32.426, oblast: "Chernihiv", aliases: ["борзна", "борзну"] },
  bobrovytsia: { name: "Bobrovytsia", nameUk: "Бобровиця", lat: 50.746, lon: 31.387, oblast: "Chernihiv", aliases: ["бобровиця", "бобровицю", "бобровица"] },
  kozelets: { name: "Kozelets", nameUk: "Козелець", lat: 50.912, lon: 31.116, oblast: "Chernihiv", aliases: ["козелець", "козельця", "козелец"] },
  oster: { name: "Oster", nameUk: "Остер", lat: 50.950, lon: 30.882, oblast: "Chernihiv", aliases: ["остер", "остра"] },
  semenivka_ch: { name: "Semenivka", nameUk: "Семенівка", lat: 52.178, lon: 32.581, oblast: "Chernihiv", isFrontline: true, aliases: ["семенівка", "семенівку", "семеновка"] },
  snovsk: { name: "Snovsk", nameUk: "Сновськ", lat: 51.821, lon: 31.949, oblast: "Chernihiv", isFrontline: true, aliases: ["сновськ", "сновск"] },
  borodianka: { name: "Borodianka", nameUk: "Бородянка", lat: 50.644, lon: 29.932, oblast: "Kyiv", aliases: ["бородянка", "бородянку"] },
  ivankiv: { name: "Ivankiv", nameUk: "Іванків", lat: 50.934, lon: 29.901, oblast: "Kyiv", aliases: ["іванків", "іванкова", "иванков"] },
  pereiaslav: { name: "Pereiaslav", nameUk: "Переяслав", lat: 50.072, lon: 31.448, oblast: "Kyiv", aliases: ["переяслав", "переяслава"] },
  yahotyn: { name: "Yahotyn", nameUk: "Яготин", lat: 50.258, lon: 31.782, oblast: "Kyiv", aliases: ["яготин", "яготина"] },
  kaharlyk: { name: "Kaharlyk", nameUk: "Кагарлик", lat: 49.863, lon: 30.822, oblast: "Kyiv", aliases: ["кагарлик", "кагарлика"] },
  myronivka: { name: "Myronivka", nameUk: "Миронівка", lat: 49.662, lon: 30.985, oblast: "Kyiv", aliases: ["миронівка", "миронівку", "мироновка"] },
  bohuslav: { name: "Bohuslav", nameUk: "Богуслав", lat: 49.547, lon: 30.878, oblast: "Kyiv", aliases: ["богуслав", "богуслава"] },
  trypillia: { name: "Trypillia", nameUk: "Трипілля", lat: 50.114, lon: 30.770, oblast: "Kyiv", aliases: ["трипілля", "трипільська тес", "триполье"] },
  ukrainka: { name: "Ukrainka", nameUk: "Українка", lat: 50.149, lon: 30.742, oblast: "Kyiv", aliases: ["українка", "українку"] },
  vyshneve: { name: "Vyshneve", nameUk: "Вишневе", lat: 50.388, lon: 30.369, oblast: "Kyiv", aliases: ["вишневе", "вишневое"] },
  boiarka: { name: "Boiarka", nameUk: "Боярка", lat: 50.329, lon: 30.295, oblast: "Kyiv", aliases: ["боярка", "боярку"] },
  shpola: { name: "Shpola", nameUk: "Шпола", lat: 49.007, lon: 31.396, oblast: "Cherkasy", aliases: ["шпола", "шполу"] },
  zhashkiv: { name: "Zhashkiv", nameUk: "Жашків", lat: 49.245, lon: 30.109, oblast: "Cherkasy", aliases: ["жашків", "жашкова", "жашков"] },
  talne: { name: "Talne", nameUk: "Тальне", lat: 48.888, lon: 30.703, oblast: "Cherkasy", aliases: ["тальне", "тального"] },
  chyhyryn: { name: "Chyhyryn", nameUk: "Чигирин", lat: 49.077, lon: 32.656, oblast: "Cherkasy", aliases: ["чигирин", "чигирина"] },
  hadiach: { name: "Hadiach", nameUk: "Гадяч", lat: 50.367, lon: 33.989, oblast: "Poltava", aliases: ["гадяч", "гадяча"] },
  zinkiv: { name: "Zinkiv", nameUk: "Зіньків", lat: 50.207, lon: 34.364, oblast: "Poltava", aliases: ["зіньків", "зиньков"] },
  karlivka: { name: "Karlivka", nameUk: "Карлівка", lat: 49.455, lon: 35.131, oblast: "Poltava", aliases: ["карлівка", "карлівку", "карловка"] },
  lokhvytsia: { name: "Lokhvytsia", nameUk: "Лохвиця", lat: 50.358, lon: 33.266, oblast: "Poltava", aliases: ["лохвиця", "лохвицю", "лохвица"] },
  hrebinka: { name: "Hrebinka", nameUk: "Гребінка", lat: 50.115, lon: 32.432, oblast: "Poltava", aliases: ["гребінка", "гребінку", "гребенка"] },
  hlobyne: { name: "Hlobyne", nameUk: "Глобине", lat: 49.391, lon: 33.255, oblast: "Poltava", aliases: ["глобине", "глобино"] },
  horishni_plavni: { name: "Horishni Plavni", nameUk: "Горішні Плавні", lat: 49.017, lon: 33.658, oblast: "Poltava", aliases: ["горішні плавні", "горишние плавни"] },
  khmilnyk: { name: "Khmilnyk", nameUk: "Хмільник", lat: 49.556, lon: 27.957, oblast: "Vinnytsia", aliases: ["хмільник", "хмельник"] },
  kalynivka: { name: "Kalynivka", nameUk: "Калинівка", lat: 49.447, lon: 28.523, oblast: "Vinnytsia", aliases: ["калинівка", "калинівку", "калиновка"] },
  tulchyn: { name: "Tulchyn", nameUk: "Тульчин", lat: 48.674, lon: 28.849, oblast: "Vinnytsia", aliases: ["тульчин", "тульчина"] },
  nemyriv: { name: "Nemyriv", nameUk: "Немирів", lat: 48.978, lon: 28.843, oblast: "Vinnytsia", aliases: ["немирів", "немирова", "немиров"] },
  bershad: { name: "Bershad", nameUk: "Бершадь", lat: 48.372, lon: 29.532, oblast: "Vinnytsia", aliases: ["бершадь"] },
  chechelnyk: { name: "Chechelnyk", nameUk: "Чечельник", lat: 48.215, lon: 29.354, oblast: "Vinnytsia", aliases: ["чечельник", "чечельника"] },
  tyshkivka: { name: "Tyshkivka", nameUk: "Тишківка", lat: 48.494, lon: 30.929, oblast: "Kirovohrad", aliases: ["тишківка", "тишківки", "тишківку"] },
  popilnia: { name: "Popilnia", nameUk: "Попільня", lat: 49.946, lon: 29.457, oblast: "Zhytomyr", aliases: ["попільня", "попільню"] },
  andrushivka: { name: "Andrushivka", nameUk: "Андрушівка", lat: 50.028, lon: 29.023, oblast: "Zhytomyr", aliases: ["андрушівка", "андрушівку"] },
  chudniv: { name: "Chudniv", nameUk: "Чуднів", lat: 50.052, lon: 28.097, oblast: "Zhytomyr", aliases: ["чуднів", "чуднова", "чуднов"] },
  kostopil: { name: "Kostopil", nameUk: "Костопіль", lat: 50.884, lon: 26.447, oblast: "Rivne", aliases: ["костопіль", "костополь"] },
  zdolbuniv: { name: "Zdolbuniv", nameUk: "Здолбунів", lat: 50.511, lon: 26.259, oblast: "Rivne", aliases: ["здолбунів", "здолбунов"] },
  ostroh: { name: "Ostroh", nameUk: "Острог", lat: 50.329, lon: 26.514, oblast: "Rivne", aliases: ["острог", "острога"] },
  novovolynsk: { name: "Novovolynsk", nameUk: "Нововолинськ", lat: 50.727, lon: 24.165, oblast: "Volyn", aliases: ["нововолинськ", "нововолынск"] },
  kamin_kashyrskyi: { name: "Kamin-Kashyrskyi", nameUk: "Камінь-Каширський", lat: 51.621, lon: 24.961, oblast: "Volyn", aliases: ["камінь-каширський"] },
  kamianets_podilskyi: { name: "Kamianets-Podilskyi", nameUk: "Кам'янець-Подільський", lat: 48.683, lon: 26.583, oblast: "Khmelnytskyi", aliases: ["кам'янець-подільський", "каменец-подольский"] },
  polonne: { name: "Polonne", nameUk: "Полонне", lat: 50.123, lon: 27.510, oblast: "Khmelnytskyi", aliases: ["полонне", "полонного"] },
  iziaslav: { name: "Iziaslav", nameUk: "Ізяслав", lat: 50.119, lon: 26.821, oblast: "Khmelnytskyi", aliases: ["ізяслав", "изяслав"] },
  krasyliv: { name: "Krasyliv", nameUk: "Красилів", lat: 49.651, lon: 26.974, oblast: "Khmelnytskyi", aliases: ["красилів", "красилов"] },
  volochysk: { name: "Volochysk", nameUk: "Волочиськ", lat: 49.535, lon: 26.200, oblast: "Khmelnytskyi", aliases: ["волочиськ", "волочиск"] },
  stryi: { name: "Stryi", nameUk: "Стрий", lat: 49.262, lon: 23.850, oblast: "Lviv", aliases: ["стрий", "стрия", "стрый"] },
  drohobych: { name: "Drohobych", nameUk: "Дрогобич", lat: 49.354, lon: 23.505, oblast: "Lviv", aliases: ["дрогобич", "дрогобича", "дрогобыч"] },
  sheptytskyi: { name: "Sheptytskyi", nameUk: "Шептицький", lat: 50.386, lon: 24.229, oblast: "Lviv", aliases: ["шептицький", "червоноград"] },
  sambir: { name: "Sambir", nameUk: "Самбір", lat: 49.518, lon: 23.203, oblast: "Lviv", aliases: ["самбір", "самбора", "самбор"] },
  brody: { name: "Brody", nameUk: "Броди", lat: 50.087, lon: 25.147, oblast: "Lviv", aliases: ["броди", "броды"] },
  yavoriv: { name: "Yavoriv", nameUk: "Яворів", lat: 49.947, lon: 23.393, oblast: "Lviv", aliases: ["яворів", "яворова", "яворов"] },
  kalush: { name: "Kalush", nameUk: "Калуш", lat: 49.026, lon: 24.365, oblast: "Ivano-Frankivsk", aliases: ["калуш", "калуша"] },
  kolomyia: { name: "Kolomyia", nameUk: "Коломия", lat: 48.531, lon: 25.040, oblast: "Ivano-Frankivsk", aliases: ["коломия", "коломию", "коломыя"] },
  burshtyn: { name: "Burshtyn", nameUk: "Бурштин", lat: 49.261, lon: 24.630, oblast: "Ivano-Frankivsk", aliases: ["бурштин", "бурштинська тес", "бурштын"] },
  chortkiv: { name: "Chortkiv", nameUk: "Чортків", lat: 49.017, lon: 25.798, oblast: "Ternopil", aliases: ["чортків", "чорткова", "чортков"] },
  kremenets: { name: "Kremenets", nameUk: "Кременець", lat: 50.108, lon: 25.727, oblast: "Ternopil", aliases: ["кременець", "кременец"] },
  mukachevo: { name: "Mukachevo", nameUk: "Мукачево", lat: 48.441, lon: 22.718, oblast: "Zakarpattia", aliases: ["мукачево", "мукачеве"] },
  khust: { name: "Khust", nameUk: "Хуст", lat: 48.181, lon: 23.298, oblast: "Zakarpattia", aliases: ["хуст", "хуста"] },
  beryslav: { name: "Beryslav", nameUk: "Берислав", lat: 46.842, lon: 33.428, oblast: "Kherson", isFrontline: true, aliases: ["берислав", "берислава"] },
  chornobaivka: { name: "Chornobaivka", nameUk: "Чорнобаївка", lat: 46.701, lon: 32.553, oblast: "Kherson", isFrontline: true, aliases: ["чорнобаївка", "чорнобаївку", "чернобаевка"] },
  antonivka: { name: "Antonivka", nameUk: "Антонівка", lat: 46.678, lon: 32.736, oblast: "Kherson", isFrontline: true, aliases: ["антонівка", "антонівку", "антоновка"] },
  bilozerka: { name: "Bilozerka", nameUk: "Білозерка", lat: 46.625, lon: 32.442, oblast: "Kherson", isFrontline: true, aliases: ["білозерка", "білозерку", "белозерка"] },
  kushuhum: { name: "Kushuhum", nameUk: "Кушугум", lat: 47.710, lon: 35.217, oblast: "Zaporizhzhia", isFrontline: true, aliases: ["кушугум", "кушугума"] },
  malokaterynivka: { name: "Malokaterynivka", nameUk: "Малокатеринівка", lat: 47.656, lon: 35.259, oblast: "Zaporizhzhia", isFrontline: true, aliases: ["малокатеринівка", "малокатеринівку"] },
  balabyne: { name: "Balabyne", nameUk: "Балабине", lat: 47.743, lon: 35.221, oblast: "Zaporizhzhia", isFrontline: true, aliases: ["балабине", "балабино"] },
  enerhodar: { name: "Enerhodar", nameUk: "Енергодар", lat: 47.499, lon: 34.656, oblast: "Zaporizhzhia", isFrontline: true, aliases: ["енергодар", "энергодар"] },
  tokmak: { name: "Tokmak", nameUk: "Токмак", lat: 47.252, lon: 35.706, oblast: "Zaporizhzhia", isFrontline: true, aliases: ["токмак", "токмака"] },
  zhovti_vody: { name: "Zhovti Vody", nameUk: "Жовті Води", lat: 48.348, lon: 33.503, oblast: "Dnipropetrovsk", aliases: ["жовті води", "жовтих вод", "желтые воды"] },
  ternivka: { name: "Ternivka", nameUk: "Тернівка", lat: 48.524, lon: 36.077, oblast: "Dnipropetrovsk", aliases: ["тернівка", "тернівку", "терновка"] },
  shakhtarske: { name: "Shakhtarske", nameUk: "Шахтарське", lat: 48.346, lon: 36.402, oblast: "Dnipropetrovsk", aliases: ["шахтарське", "першотравенськ"] },
  solone: { name: "Solone", nameUk: "Солоне", lat: 48.206, lon: 34.872, oblast: "Dnipropetrovsk", aliases: ["солоне", "солоного"] },
  pokrov_dp: { name: "Pokrov", nameUk: "Покров", lat: 47.653, lon: 34.084, oblast: "Dnipropetrovsk", isFrontline: true, aliases: ["покров", "покрова"] },
  tsarychanka: { name: "Tsarychanka", nameUk: "Царичанка", lat: 48.938, lon: 34.481, oblast: "Dnipropetrovsk", aliases: ["царичанка", "царичанку"] },
  novoukrainka: { name: "Novoukrainka", nameUk: "Новоукраїнка", lat: 48.316, lon: 31.527, oblast: "Kirovohrad", aliases: ["новоукраїнка", "новоукраїнку", "новоукраинка"] },
  bobrynets: { name: "Bobrynets", nameUk: "Бобринець", lat: 48.058, lon: 32.159, oblast: "Kirovohrad", aliases: ["бобринець", "бобринця", "бобринец"] },
  pomichna: { name: "Pomichna", nameUk: "Помічна", lat: 48.243, lon: 31.406, oblast: "Kirovohrad", aliases: ["помічна", "помічну"] },
  myrnohrad: { name: "Myrnohrad", nameUk: "Мирноград", lat: 48.291, lon: 37.268, oblast: "Donetsk", isFrontline: true, aliases: ["мирноград", "мирнограда"] },
  selydove: { name: "Selydove", nameUk: "Селидове", lat: 48.150, lon: 37.304, oblast: "Donetsk", isFrontline: true, aliases: ["селидове", "селидово"] },
  kurakhove: { name: "Kurakhove", nameUk: "Курахове", lat: 47.985, lon: 37.291, oblast: "Donetsk", isFrontline: true, aliases: ["курахове", "курахово"] },
  chasiv_yar: { name: "Chasiv Yar", nameUk: "Часів Яр", lat: 48.591, lon: 37.835, oblast: "Donetsk", isFrontline: true, aliases: ["часів яр", "часов яр"] },
  toretsk: { name: "Toretsk", nameUk: "Торецьк", lat: 48.397, lon: 37.854, oblast: "Donetsk", isFrontline: true, aliases: ["торецьк", "торецк"] },
  sviatohirsk: { name: "Sviatohirsk", nameUk: "Святогірськ", lat: 49.041, lon: 37.567, oblast: "Donetsk", isFrontline: true, aliases: ["святогірськ", "святогорск"] },
  siversk: { name: "Siversk", nameUk: "Сіверськ", lat: 48.868, lon: 38.106, oblast: "Donetsk", isFrontline: true, aliases: ["сіверськ", "северск"] },
  berestyn: { name: "Berestyn", nameUk: "Берестин", lat: 49.372, lon: 35.457, oblast: "Kharkiv", aliases: ["берестин", "красноград"] },
  zlatopil: { name: "Zlatopil", nameUk: "Златопіль", lat: 49.387, lon: 36.214, oblast: "Kharkiv", aliases: ["златопіль", "первомайський"] },
  zmiiv: { name: "Zmiiv", nameUk: "Зміїв", lat: 49.687, lon: 36.357, oblast: "Kharkiv", isFrontline: true, aliases: ["зміїв", "змієва", "змиев"] },
  merefa: { name: "Merefa", nameUk: "Мерефа", lat: 49.814, lon: 36.062, oblast: "Kharkiv", isFrontline: true, aliases: ["мерефа", "мерефу"] },
  pisochyn: { name: "Pisochyn", nameUk: "Пісочин", lat: 49.955, lon: 36.110, oblast: "Kharkiv", isFrontline: true, aliases: ["пісочин", "песочин"] },
  valky: { name: "Valky", nameUk: "Валки", lat: 49.839, lon: 35.622, oblast: "Kharkiv", aliases: ["валки", "валок"] },
  kozacha_lopan: { name: "Kozacha Lopan", nameUk: "Козача Лопань", lat: 50.335, lon: 36.170, oblast: "Kharkiv", isFrontline: true, aliases: ["козача лопань", "казачья лопань"] },
  lyptsi: { name: "Lyptsi", nameUk: "Липці", lat: 50.207, lon: 36.425, oblast: "Kharkiv", isFrontline: true, aliases: ["липці", "липцы"] },
  staryi_saltiv: { name: "Staryi Saltiv", nameUk: "Старий Салтів", lat: 50.077, lon: 36.794, oblast: "Kharkiv", isFrontline: true, aliases: ["старий салтів", "старый салтов"] },
  pechenihy: { name: "Pechenihy", nameUk: "Печеніги", lat: 49.874, lon: 36.939, oblast: "Kharkiv", isFrontline: true, aliases: ["печеніги", "печенеги"] },
  velykyi_burluk: { name: "Velykyi Burluk", nameUk: "Великий Бурлук", lat: 50.068, lon: 37.392, oblast: "Kharkiv", isFrontline: true, aliases: ["великий бурлук", "великого бурлука"] },
  nova_vodolaha: { name: "Nova Vodolaha", nameUk: "Нова Водолага", lat: 49.721, lon: 35.875, oblast: "Kharkiv", aliases: ["нова водолага", "нову водолагу", "новая водолага"] },

  // Operational region centroids (matched only when no specific city/town fits)
  kyivshchyna: { name: "Kyiv Region", nameUk: "Київщина", lat: 50.45, lon: 30.52, oblast: "Kyiv", isRegion: true, aliases: ["київщина", "київщину", "київщині", "київська область", "киевская область"] },
  zhytomyrshchyna: { name: "Zhytomyr Region", nameUk: "Житомирщина", lat: 50.50, lon: 28.60, oblast: "Zhytomyr", isRegion: true, aliases: ["житомирщина", "житомирщину", "житомирщині", "житомирська область"] },
  chernihivshchyna: { name: "Chernihiv Region", nameUk: "Чернігівщина", lat: 51.50, lon: 31.80, oblast: "Chernihiv", isRegion: true, aliases: ["чернігівщина", "чернігівщину", "чернігівщині", "чернігівська область"] },
  sumshchyna: { name: "Sumy Region", nameUk: "Сумщина", lat: 50.90, lon: 34.50, oblast: "Sumy", isRegion: true, isFrontline: true, aliases: ["сумщина", "сумщину", "сумщині", "сумська область"] },
  poltavshchyna: { name: "Poltava Region", nameUk: "Полтавщина", lat: 49.60, lon: 34.00, oblast: "Poltava", isRegion: true, aliases: ["полтавщина", "полтавщину", "полтавщині", "полтавська область"] },
  cherkashchyna: { name: "Cherkasy Region", nameUk: "Черкащина", lat: 49.40, lon: 31.50, oblast: "Cherkasy", isRegion: true, aliases: ["черкащина", "черкащину", "черкащині", "черкаська область"] },
  rivnenshchyna: { name: "Rivne Region", nameUk: "Рівненщина", lat: 50.80, lon: 26.50, oblast: "Rivne", isRegion: true, aliases: ["рівненщина", "рівненщину", "рівненська область"] },
  volyn_reg: { name: "Volyn Region", nameUk: "Волинь", lat: 51.00, lon: 25.00, oblast: "Volyn", isRegion: true, aliases: ["волинь", "волинська область"] },
  khmelnychchyna: { name: "Khmelnytskyi Region", nameUk: "Хмельниччина", lat: 49.50, lon: 27.00, oblast: "Khmelnytskyi", isRegion: true, aliases: ["хмельниччина", "хмельниччину", "хмельницька область"] },
  vinnychchyna: { name: "Vinnytsia Region", nameUk: "Вінниччина", lat: 49.10, lon: 28.50, oblast: "Vinnytsia", isRegion: true, aliases: ["вінниччина", "вінниччину", "вінницька область"] },
  dnipropetrovshchyna: { name: "Dnipro Region", nameUk: "Дніпропетровщина", lat: 48.50, lon: 35.00, oblast: "Dnipropetrovsk", isRegion: true, aliases: ["дніпропетровщина", "дніпропетровщину", "дніпропетровська область"] },
  kharkivshchyna: { name: "Kharkiv Region", nameUk: "Харківщина", lat: 49.80, lon: 36.50, oblast: "Kharkiv", isRegion: true, isFrontline: true, aliases: ["харківщина", "харківщину", "харківська область", "харьковская область"] },
  odeshchyna: { name: "Odesa Region", nameUk: "Одещина", lat: 46.80, lon: 30.30, oblast: "Odesa", isRegion: true, aliases: ["одещина", "одещину", "одеська область"] },
  mykolaivshchyna: { name: "Mykolaiv Region", nameUk: "Миколаївщина", lat: 47.20, lon: 32.00, oblast: "Mykolaiv", isRegion: true, aliases: ["миколаївщина", "миколаївщину", "миколаївська область"] },
  kirovohradshchyna: { name: "Kirovohrad Region", nameUk: "Кіровоградщина", lat: 48.50, lon: 32.00, oblast: "Kirovohrad", isRegion: true, aliases: ["кіровоградщина", "кіровоградщину", "кіровоградська область"] },
  zaporizhzhia_reg: { name: "Zaporizhzhia Region", nameUk: "Запорізька область", lat: 47.70, lon: 35.40, oblast: "Zaporizhzhia", isRegion: true, isFrontline: true, aliases: ["запорізька область", "запорожская область"] },
  donetsk_reg: { name: "Donetsk Region", nameUk: "Донеччина", lat: 48.40, lon: 37.30, oblast: "Donetsk", isRegion: true, isFrontline: true, aliases: ["донеччина", "донецька область", "донецкая область"] }
};

export const isInsideUkraineGeo = (lat: number, lon: number): boolean => {
  if (lat < 44.3 || lat > 52.45 || lon < 22.1 || lon > 40.3) {
    return false;
  }
  return isPointInPolygon(lat, lon, UKRAINE_BORDER_POLYGON);
};

// Compass directions in Ukrainian / Russian / English
export const COMPASS_DIRECTIONS: Record<string, number> = {
  "північ": 0,
  "север": 0,
  "north": 0,
  "північний схід": 45,
  "північно-східний": 45,
  "северо-восток": 45,
  "northeast": 45,
  "схід": 90,
  "восток": 90,
  "east": 90,
  "південний схід": 135,
  "південно-східний": 135,
  "юго-восток": 135,
  "southeast": 135,
  "південь": 180,
  "юг": 180,
  "south": 180,
  "південний захід": 225,
  "південно-західний": 225,
  "юго-запад": 225,
  "southwest": 225,
  "захід": 270,
  "запад": 270,
  "west": 270,
  "північний захід": 315,
  "північно-західний": 315,
  "северо-запад": 315,
  "northwest": 315
};

// "FROM <direction>" -> vector heads in opposite compass direction!
const FROM_DIRECTION_PHRASES: Array<{ phrase: string; heading: number }> = [
  { phrase: "з північного сходу", heading: 225 },
  { phrase: "із північного сходу", heading: 225 },
  { phrase: "с северо востока", heading: 225 },
  { phrase: "з північного заходу", heading: 135 },
  { phrase: "із північного заходу", heading: 135 },
  { phrase: "с северо запада", heading: 135 },
  { phrase: "з південного сходу", heading: 315 },
  { phrase: "із південного сходу", heading: 315 },
  { phrase: "с юго востока", heading: 315 },
  { phrase: "з південного заходу", heading: 45 },
  { phrase: "із південного заходу", heading: 45 },
  { phrase: "с юго запада", heading: 45 },
  { phrase: "з півночі", heading: 180 },
  { phrase: "із півночі", heading: 180 },
  { phrase: "с севера", heading: 180 },
  { phrase: "з півдня", heading: 0 },
  { phrase: "із півдня", heading: 0 },
  { phrase: "с юга", heading: 0 },
  { phrase: "зі сходу", heading: 270 },
  { phrase: "з сходу", heading: 270 },
  { phrase: "с востока", heading: 270 },
  { phrase: "із заходу", heading: 90 },
  { phrase: "з заходу", heading: 90 },
  { phrase: "с запада", heading: 90 }
];

const LATIN_TO_CYRILLIC_HOMOGLYPHS: Record<string, string> = {
  a: "а",
  c: "с",
  e: "е",
  i: "і",
  k: "к",
  m: "м",
  o: "о",
  p: "р",
  t: "т",
  x: "х",
  y: "у",
  A: "А",
  B: "В",
  C: "С",
  E: "Е",
  H: "Н",
  I: "І",
  K: "К",
  M: "М",
  O: "О",
  P: "Р",
  T: "Т",
  X: "Х",
  Y: "У"
};

/**
 * Replaces Latin lookalike homoglyphs inside words containing Cyrillic letters
 * (common in Telegram monitoring channels to evade anti-spam filters, e.g. "Пуcки KAБів").
 * Pure Latin tokens (FPV, UAV, Shahed) are left intact.
 */
export const deobfuscateCyrillic = (text: string): string =>
  text.replace(/[\p{L}\p{N}'’ʼ]+/gu, (token) => {
    if (!/[\u0400-\u04FF]/.test(token)) return token;
    return token.replace(/[aceikmoptxyABCEHIKMOPTXY]/g, (ch) => LATIN_TO_CYRILLIC_HOMOGLYPHS[ch] ?? ch);
  });

const DISTRICT_STEM_MAP: Record<string, string> = {
  "територіальна": "",
  "селищна": "",
  "міська": "",
  "громада": "",
  "район": "",
  "золотоніський": "золотоноша",
  "подільський": "подільськ",
  "лубенський": "лубни",
  "прилуцький": "прилуки",
  "бучанський": "буча",
  "вишгородський": "вишгород",
  "коростенський": "коростень",
  "звягельський": "звягель",
  "роменський": "ромни",
  "конотопський": "конотоп",
  "криворізький": "кривий ріг",
  "лозівський": "лозова",
  "чугуївський": "чугуїв",
  "павлоградський": "павлоград",
  "дніпровський": "дніпро",
  "нікопольський": "нікополь",
  "куп'янський": "куп'янськ",
  "ізюмський": "ізюм",
  "ніжинський": "ніжин",
  "охтирський": "охтирка",
  "корюківський": "корюківка",
  "синельниківський": "синельникове",
  "березівський": "березівка",
  "василівський": "василівка",
  "пологівський": "пологи",
  "волноваський": "волноваха",
  "краматорський": "краматорськ",
  "покровський": "покровськ",
  "бахмутський": "бахмут",
  "маріупольський": "маріуполь",
  "мелітопольський": "мелітополь",
  "бердянський": "бердянськ",
  "чернігівський": "чернігів",
  "сумський": "суми",
  "харківський": "харків",
  "запорізький": "запоріжжя",
  "черкаський": "черкаси",
  "новгород-сіверський": "новгород-сіверський",
  "кальміуський": "донецьк",
  "горлівський": "горлівка",
  "донецький": "донецьк",
  "красноградський": "берестин",
  "берестинський": "берестин",
  "богодухівський": "богодухів",
  "шосткинський": "шостка",
  "білоцерківський": "біла церква",
  "бориспільський": "бориспіль",
  "броварський": "бровари",
  "обухівський": "обухів",
  "фастівський": "фастів",
  "житомирський": "житомир",
  "бердичівський": "бердичів",
  "вінницький": "вінниця",
  "жмеринський": "жмеринка",
  "гайсинський": "гайсин",
  "тульчинський": "тульчин",
  "хмільницький": "хмільник",
  "полтавський": "полтава",
  "кременчуцький": "кременчук",
  "миргородський": "миргород",
  "уманський": "умань",
  "звенигородський": "звенигородка",
  "кропивницький": "кропивницький",
  "олександрійський": "олександрія",
  "новоукраїнський": "новоукраїнка",
  "херсонський": "херсон",
  "бериславський": "берислав",
  "миколаївський": "миколаїв",
  "баштанський": "баштанка",
  "первомайський": "первомайськ",
  "вознесенський": "вознесенськ",
  "одеський": "одеса",
  "ізмаїльський": "ізмаїл",
  "болградський": "болград",
  "роздільнянський": "роздільна",
  "кам'янський": "кам'янське",
  "самарівський": "самар",
  "новомосковський": "самар",
  "хмельницький": "хмельницький",
  "шепетівський": "шепетівка",
  "рівненський": "рівне",
  "дубенський": "дубно",
  "сарненський": "сарни",
  "вараський": "вараш",
  "луцький": "луцьк",
  "ковельський": "ковель",
  "володимирський": "володимир",
  "тернопільський": "тернопіль",
  "чортківський": "чортків",
  "кременецький": "кременець",
  "львівський": "львів",
  "дрогобицький": "дрогобич",
  "стрийський": "стрий",
  "самбірський": "самбір",
  "яворівський": "яворів",
  "золочівський": "золочів",
  "червоноградський": "шептицький",
  "івано-франківський": "івано-франківськ",
  "калуський": "калуш",
  "коломийський": "коломия",
  "чернівецький": "чернівці",
  "ужгородський": "ужгород",
  "мукачівський": "мукачево",
  "хустський": "хуст",
  "липецька": "липці",
  "вовчанська": "вовчанськ",
  "марганецька": "марганець",
  "покровська": "покров",
  "червоногригорівська": "червоногригорівка",
  "малинській": "малин",
  "малинська": "малин"
};

export const normalizeUkText = (text: string): string => {
  const cleaned = deobfuscateCyrillic(text)
    .toLowerCase()
    .replace(/[’ʼ`]/g, "'")
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  return cleaned
    .split(" ")
    .map((tok) => (tok in DISTRICT_STEM_MAP ? DISTRICT_STEM_MAP[tok] : tok))
    .filter(Boolean)
    .join(" ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

export const calculateBearing = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
  const theta = Math.atan2(y, x);
  return Math.round(((theta * 180) / Math.PI + 360) % 360);
};

interface MatchedMention {
  key: string;
  point: GeoPoint;
  pos: number;
  termLen: number;
}

const ALL_CITY_ENTRIES = Object.entries(UKRAINE_CITIES);

function findAllMentionsInNormalized(normalized: string): MatchedMention[] {
  const padded = ` ${normalized} `;
  const found: MatchedMention[] = [];

  for (const [key, point] of ALL_CITY_ENTRIES) {
    const terms = new Set<string>();
    const nameLower = normalizeUkText(point.nameUk);
    terms.add(nameLower);
    if (nameLower.length > 4 && /[аяеоиуію]$/.test(nameLower)) {
      terms.add(nameLower.slice(0, -1));
    }
    // Ukrainian locative/dative consonant alternation: -ка -> -ці, -га -> -зі, -ха -> -сі (e.g. Затока -> Затоці, Охтирка -> Охтирці)
    if (nameLower.length > 4 && nameLower.endsWith("ка")) {
      terms.add(`${nameLower.slice(0, -2)}ці`);
    } else if (nameLower.length > 4 && nameLower.endsWith("га")) {
      terms.add(`${nameLower.slice(0, -2)}зі`);
    } else if (nameLower.length > 4 && nameLower.endsWith("ха")) {
      terms.add(`${nameLower.slice(0, -2)}сі`);
    }
    for (const a of point.aliases ?? []) {
      terms.add(normalizeUkText(a));
    }

    let bestPos = Infinity;
    let bestTermLen = 0;
    for (const term of terms) {
      if (term.length < 3) continue;
      // Match whole-token prefix (space before term) so substrings inside unrelated words don't trigger
      const idx = padded.indexOf(` ${term}`);
      if (idx !== -1) {
        const afterChar = padded[idx + 1 + term.length];
        // Ensure full word match or Cyrillic inflection (<= 3 extra letters for noun case endings)
        const nextSpace = padded.indexOf(" ", idx + 1);
        const wordLen = nextSpace === -1 ? term.length : nextSpace - (idx + 1);
        if (wordLen <= term.length + 3 || afterChar === " ") {
          if (idx < bestPos || (idx === bestPos && term.length > bestTermLen)) {
            bestPos = idx;
            bestTermLen = term.length;
          }
        }
      }
    }

    if (bestPos < Infinity) {
      found.push({ key, point, pos: bestPos, termLen: bestTermLen });
    }
  }

  // Deduplicate matches at the exact same token position by keeping the longest matching settlement name
  // (e.g. "на Васильківку" matches "васильківка" [len 11] and must not also match "васильків" [len 9])
  const byPos = new Map<number, { key: string; point: GeoPoint; pos: number; termLen: number }>();
  for (const item of found) {
    const prev = byPos.get(item.pos);
    if (
      !prev ||
      item.termLen > prev.termLen ||
      (item.termLen === prev.termLen && !item.point.isRegion && prev.point.isRegion)
    ) {
      byPos.set(item.pos, item);
    }
  }

  const deduped = Array.from(byPos.values());
  deduped.sort((a, b) => a.pos - b.pos || (a.point.isRegion ? 1 : 0) - (b.point.isRegion ? 1 : 0));
  return deduped;
}

export const findCityInText = (text: string): GeoPoint | null => {
  const normalized = normalizeUkText(text);
  const mentions = findAllMentionsInNormalized(normalized);
  if (mentions.length === 0) return null;
  // Prefer specific town/city over generic region centroid if any town exists
  const specific = mentions.find((m) => !m.point.isRegion);
  return specific ? specific.point : mentions[0].point;
};

export interface GeoContextResult {
  origin?: { key: string; point: GeoPoint };
  destination?: { key: string; point: GeoPoint };
  primary?: { key: string; point: GeoPoint };
  approachHeading?: number;
  isApproachingDestination?: boolean;
}

/**
 * Extracts structured route semantics from natural-language tactical alerts:
 * - "на Миколаїв із заходу" -> destination: Миколаїв, approachHeading: 90, isApproachingDestination: true
 * - "з Київщини на Житомирщину, курсом на Овруч" -> origin: Київщина, destination: Овруч
 * - "у напрямку м. Запоріжжя з півдня" -> destination: Запоріжжя, approachHeading: 0, isApproachingDestination: true
 */
export const findGeoContextInText = (text: string, regionHint?: string): GeoContextResult => {
  const normalized = normalizeUkText(text);
  const mentions = findAllMentionsInNormalized(normalized);

  let approachHeading: number | undefined;
  let isFromDirection = false;
  for (const item of FROM_DIRECTION_PHRASES) {
    if (normalized.includes(item.phrase)) {
      approachHeading = item.heading;
      isFromDirection = true;
      break;
    }
  }

  const specificMentions = mentions.filter((m) => !m.point.isRegion);
  const regionMentions = mentions.filter((m) => m.point.isRegion);

  // Use regionHint if only generic mentions or to resolve region
  if (specificMentions.length >= 2) {
    const first = specificMentions[0];
    const last = specificMentions[specificMentions.length - 1];
    const heading = approachHeading ?? calculateBearing(first.point.lat, first.point.lon, last.point.lat, last.point.lon);
    return {
      origin: { key: first.key, point: first.point },
      destination: { key: last.key, point: last.point },
      primary: { key: first.key, point: first.point },
      approachHeading: heading,
      isApproachingDestination: true
    };
  }

  if (specificMentions.length === 1) {
    const city = specificMentions[0];
    // Check if there is an explicit "на/в бік/у напрямку <city>" pattern -> city is DESTINATION
    const cityAliases = [normalizeUkText(city.point.nameUk), ...(city.point.aliases ?? []).map(normalizeUkText)];
    const isDestPhrase = cityAliases.some(
      (a) =>
        normalized.includes(`на ${a.slice(0, Math.max(4, a.length - 1))}`) ||
        normalized.includes(`у напрямку`) ||
        normalized.includes(`в бік`) ||
        normalized.includes(`в сторону`) ||
        normalized.includes(`напрямок`) ||
        normalized.includes(`курсом на`)
    );

    // If there is a separate origin oblast distinct from destination city's oblast (e.g. "з Київщини на Овруч")
    const originRegion = regionMentions.find(
      (r) =>
        r.pos < city.pos &&
        r.point.oblast !== city.point.oblast
    );

    if (originRegion) {
      const heading = approachHeading ?? calculateBearing(originRegion.point.lat, originRegion.point.lon, city.point.lat, city.point.lon);
      return {
        origin: { key: originRegion.key, point: originRegion.point },
        destination: { key: city.key, point: city.point },
        primary: { key: city.key, point: city.point },
        approachHeading: heading,
        isApproachingDestination: true
      };
    }

    return {
      destination: isDestPhrase || isFromDirection ? { key: city.key, point: city.point } : undefined,
      primary: { key: city.key, point: city.point },
      approachHeading: approachHeading ?? findDirectionInText(text, city.point) ?? undefined,
      isApproachingDestination: Boolean((isDestPhrase && isFromDirection) || isFromDirection)
    };
  }

  if (regionMentions.length >= 2) {
    const first = regionMentions[0];
    const last = regionMentions[regionMentions.length - 1];
    return {
      origin: { key: first.key, point: first.point },
      destination: { key: last.key, point: last.point },
      primary: { key: first.key, point: first.point },
      approachHeading: approachHeading ?? calculateBearing(first.point.lat, first.point.lon, last.point.lat, last.point.lon),
      isApproachingDestination: true
    };
  }

  if (regionMentions.length === 1) {
    const reg = regionMentions[0];
    return {
      primary: { key: reg.key, point: reg.point },
      approachHeading: approachHeading ?? findDirectionInText(text, reg.point) ?? undefined,
      isApproachingDestination: false
    };
  }

  if (regionHint) {
    const hintMentions = findAllMentionsInNormalized(normalizeUkText(regionHint));
    if (hintMentions.length > 0) {
      return {
        primary: { key: hintMentions[0].key, point: hintMentions[0].point },
        approachHeading: approachHeading ?? findDirectionInText(text, hintMentions[0].point) ?? undefined
      };
    }
  }

  return {};
};

export const findDirectionInText = (text: string, originCity?: GeoPoint | null): number | null => {
  const normalized = normalizeUkText(text);

  // 1. Explicit "FROM <direction>" means target moves in the OPPOSITE compass direction
  for (const item of FROM_DIRECTION_PHRASES) {
    if (normalized.includes(item.phrase)) {
      return item.heading;
    }
  }

  // 2. If text targets another city: e.g. "курсом на Овруч" or "на Полтаву"
  if (originCity) {
    const mentions = findAllMentionsInNormalized(normalized);
    for (const m of mentions) {
      if (m.point.nameUk.toLowerCase() === originCity.nameUk.toLowerCase()) continue;
      if (m.point.isRegion && mentions.some((x) => !x.point.isRegion && x !== m)) continue;
      return calculateBearing(originCity.lat, originCity.lon, m.point.lat, m.point.lon);
    }
  }

  // 3. Multi-word compass directions first (longest phrase wins before single-word "північ"/"захід")
  const sortedCompass = Object.entries(COMPASS_DIRECTIONS).sort((a, b) => b[0].length - a[0].length);
  for (const [phrase, deg] of sortedCompass) {
    if (normalized.includes(phrase)) {
      return deg;
    }
  }

  // 4. Adjectival forms ("курс західний", "на захід")
  if (normalized.includes("північно західн") || normalized.includes("северо западн")) return 315;
  if (normalized.includes("північно східн") || normalized.includes("северо восточн")) return 45;
  if (normalized.includes("південно західн") || normalized.includes("юго западн")) return 225;
  if (normalized.includes("південно східн") || normalized.includes("юго восточн")) return 135;
  if (normalized.includes("західн") || normalized.includes("западн") || normalized.includes("на захід")) return 270;
  if (normalized.includes("східн") || normalized.includes("восточн") || normalized.includes("на схід")) return 90;
  if (normalized.includes("північн") || normalized.includes("северн") || normalized.includes("на північ")) return 0;
  if (normalized.includes("південн") || normalized.includes("южн") || normalized.includes("на південь")) return 180;

  return null;
};

// Active Line of Contact (Лінія бойового зіткнення / ЛБЗ) from North-East Kharkiv to Kinburn Spit ([lon, lat])
export const FRONTLINE_POLYLINE: Array<[number, number]> = [
  [37.750, 50.000],
  [37.742, 49.880],
  [37.721, 49.720],
  [37.820, 49.620],
  [37.940, 49.560],
  [37.962, 49.490],
  [37.985, 49.380],
  [38.005, 49.230],
  [38.021, 49.120],
  [38.030, 49.030],
  [38.140, 48.970],
  [38.240, 48.920],
  [38.252, 48.860],
  [38.180, 48.810],
  [38.080, 48.750],
  [37.970, 48.710],
  [37.860, 48.600],
  [37.842, 48.580],
  [37.940, 48.530],
  [37.972, 48.470],
  [37.960, 48.430],
  [37.900, 48.400],
  [37.860, 48.380],
  [37.840, 48.330],
  [37.580, 48.300],
  [37.470, 48.280],
  [37.380, 48.260],
  [37.340, 48.280],
  [37.330, 48.210],
  [37.320, 48.160],
  [37.300, 48.140],
  [37.320, 48.090],
  [37.370, 48.040],
  [37.300, 47.990],
  [37.240, 47.950],
  [37.190, 47.860],
  [37.250, 47.780],
  [37.080, 47.790],
  [36.980, 47.810],
  [36.830, 47.840],
  [36.810, 47.760],
  [36.630, 47.740],
  [36.460, 47.690],
  [36.260, 47.650],
  [36.000, 47.530],
  [35.880, 47.510],
  [35.840, 47.440],
  [35.820, 47.420],
  [35.610, 47.510],
  [35.370, 47.540],
  [35.280, 47.430],
  [35.000, 47.380],
  [34.650, 47.500],
  [34.000, 47.200],
  [33.370, 46.840],
  [33.080, 46.730],
  [32.720, 46.640],
  [32.480, 46.540],
  [31.850, 46.510]
];

/**
 * Checks whether a point lies behind the occupied side of the frontline
 * (Crimea, occupied Luhansk/Donetsk east of frontline, occupied Zaporizhzhia/Kherson south of frontline).
 */
export function isBehindOccupiedFrontline(lat: number, lon: number): boolean {
  // Crimea & Sea of Azov south
  if (lat < 46.20 && lon > 32.35) return true;
  // Deep Luhansk east of frontline
  if (lon > 38.28) return true;

  // Eastern frontline segment (lat 47.75 .. 50.00): check if point is east of frontline longitude at that latitude
  if (lat >= 47.75 && lat <= 50.00 && lon > 36.80) {
    for (let i = 0; i < FRONTLINE_POLYLINE.length - 1; i++) {
      const [lon1, lat1] = FRONTLINE_POLYLINE[i];
      const [lon2, lat2] = FRONTLINE_POLYLINE[i + 1];
      const minLat = Math.min(lat1, lat2);
      const maxLat = Math.max(lat1, lat2);
      if (lat >= minLat && lat <= maxLat) {
        const t = maxLat === minLat ? 0.5 : (lat - lat1) / (lat2 - lat1);
        const frontLon = lon1 + t * (lon2 - lon1);
        if (lon > frontLon + 0.05) return true;
      }
    }
  }

  // Southern frontline segment (Zaporizhzhia & Left-Bank Kherson, lon 31.85 .. 37.35): check if point is south of frontline latitude
  if (lon >= 31.85 && lon <= 37.40 && lat < 47.85) {
    for (let i = 25; i < FRONTLINE_POLYLINE.length - 1; i++) {
      const [lon1, lat1] = FRONTLINE_POLYLINE[i];
      const [lon2, lat2] = FRONTLINE_POLYLINE[i + 1];
      const minLon = Math.min(lon1, lon2);
      const maxLon = Math.max(lon1, lon2);
      if (lon >= minLon && lon <= maxLon) {
        const t = maxLon === minLon ? 0.5 : (lon - lon1) / (lon2 - lon1);
        const frontLat = lat1 + t * (lat2 - lat1);
        if (lat < frontLat - 0.04) return true;
      }
    }
  }

  return false;
}

/**
 * Strict Ukraine-Only Access Control Gate:
 * Returns true ONLY if (lat, lon) is inside Ukraine's national borders
 * AND on the Ukrainian-controlled side of the frontline (excludes RF, RB, foreign countries, and occupied territory).
 */
export function isControlledUkraineLocation(lat: number, lon: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (!isInsideUkraineGeo(lat, lon)) return false;
  if (isBehindOccupiedFrontline(lat, lon)) return false;
  return true;
}

/**
 * Finds the closest frontline vertex to (lat, lon) so threat trajectories near the frontline
 * originate from the frontline into controlled Ukrainian territory.
 */
export function getNearestFrontlinePoint(lat: number, lon: number): { lat: number; lon: number; distKm: number } {
  let bestLat = 48.58;
  let bestLon = 37.84;
  let minD = Infinity;
  const latCos = Math.cos((lat * Math.PI) / 180) || 1;
  for (const [fLon, fLat] of FRONTLINE_POLYLINE) {
    const dKm = Math.hypot((fLat - lat) * 111.139, (fLon - lon) * 111.139 * latCos);
    if (dKm < minD) {
      minD = dKm;
      bestLat = fLat;
      bestLon = fLon;
    }
  }
  return { lat: bestLat, lon: bestLon, distKm: minD };
}
