export interface GeoPoint {
  name: string;
  nameUk: string;
  lat: number;
  lon: number;
  oblast?: string;
  type?: "city" | "town" | "border_entry";
}

export const UKRAINE_CITIES: Record<string, GeoPoint> = {
  // Oblast centers and key cities
  kyiv: { name: "Kyiv", nameUk: "Київ", lat: 50.4501, lon: 30.5234, oblast: "Kyiv" },
  kharkiv: { name: "Kharkiv", nameUk: "Харків", lat: 49.9935, lon: 36.2304, oblast: "Kharkiv" },
  odesa: { name: "Odesa", nameUk: "Одеса", lat: 46.4825, lon: 30.7233, oblast: "Odesa" },
  dnipro: { name: "Dnipro", nameUk: "Дніпро", lat: 48.4647, lon: 35.0462, oblast: "Dnipropetrovsk" },
  zaporizhzhia: { name: "Zaporizhzhia", nameUk: "Запоріжжя", lat: 47.8388, lon: 35.1396, oblast: "Zaporizhzhia" },
  lviv: { name: "Lviv", nameUk: "Львів", lat: 49.8397, lon: 24.0297, oblast: "Lviv" },
  kryvyirih: { name: "Kryvyi Rih", nameUk: "Кривий Ріг", lat: 47.9105, lon: 33.3918, oblast: "Dnipropetrovsk" },
  mykolaiv: { name: "Mykolaiv", nameUk: "Миколаїв", lat: 46.975, lon: 31.9946, oblast: "Mykolaiv" },
  mariupol: { name: "Mariupol", nameUk: "Маріуполь", lat: 47.0951, lon: 37.5494, oblast: "Donetsk" },
  luhansk: { name: "Luhansk", nameUk: "Луганськ", lat: 48.574, lon: 39.3078, oblast: "Luhansk" },
  vinnytsia: { name: "Vinnytsia", nameUk: "Вінниця", lat: 49.2331, lon: 28.4682, oblast: "Vinnytsia" },
  poltava: { name: "Poltava", nameUk: "Полтава", lat: 49.5883, lon: 34.5514, oblast: "Poltava" },
  chernihiv: { name: "Chernihiv", nameUk: "Чернігів", lat: 51.4982, lon: 31.2893, oblast: "Chernihiv" },
  cherkasy: { name: "Cherkasy", nameUk: "Черкаси", lat: 49.4444, lon: 32.0598, oblast: "Cherkasy" },
  zhytomyr: { name: "Zhytomyr", nameUk: "Житомир", lat: 50.2547, lon: 28.6587, oblast: "Zhytomyr" },
  sumy: { name: "Sumy", nameUk: "Суми", lat: 50.9077, lon: 34.7981, oblast: "Sumy" },
  khmelnytskyi: { name: "Khmelnytskyi", nameUk: "Хмельницький", lat: 49.423, lon: 26.9871, oblast: "Khmelnytskyi" },
  chernivtsi: { name: "Chernivtsi", nameUk: "Чернівці", lat: 48.2917, lon: 25.9352, oblast: "Chernivtsi" },
  rivne: { name: "Rivne", nameUk: "Рівне", lat: 50.6199, lon: 26.2516, oblast: "Rivne" },
  kamianske: { name: "Kamianske", nameUk: "Кам'янське", lat: 48.5144, lon: 34.6152, oblast: "Dnipropetrovsk" },
  kropyvnytskyi: { name: "Kropyvnytskyi", nameUk: "Кропивницький", lat: 48.5079, lon: 32.2623, oblast: "Kirovohrad" },
  ivanofrankivsk: { name: "Ivano-Frankivsk", nameUk: "Івано-Франківськ", lat: 48.9226, lon: 24.7111, oblast: "Ivano-Frankivsk" },
  kremenchuk: { name: "Kremenchuk", nameUk: "Кременчук", lat: 49.063, lon: 33.404, oblast: "Poltava" },
  ternopil: { name: "Ternopil", nameUk: "Тернопіль", lat: 49.5535, lon: 25.5948, oblast: "Ternopil" },
  lutsk: { name: "Lutsk", nameUk: "Луцьк", lat: 50.7472, lon: 25.3254, oblast: "Volyn" },
  bila_tserkva: { name: "Bila Tserkva", nameUk: "Біла Церква", lat: 49.7989, lon: 30.1153, oblast: "Kyiv" },
  uzhhorod: { name: "Uzhhorod", nameUk: "Ужгород", lat: 48.6208, lon: 22.2879, oblast: "Zakarpattia" },
  nikopol: { name: "Nikopol", nameUk: "Нікополь", lat: 47.5756, lon: 34.3847, oblast: "Dnipropetrovsk" },
  slovyansk: { name: "Slovyansk", nameUk: "Слов'янськ", lat: 48.8532, lon: 37.625, oblast: "Donetsk" },
  kramatorsk: { name: "Kramatorsk", nameUk: "Краматорськ", lat: 48.7389, lon: 37.5844, oblast: "Donetsk" },
  melitopol: { name: "Melitopol", nameUk: "Мелітополь", lat: 46.855, lon: 35.3587, oblast: "Zaporizhzhia" },
  berdyansk: { name: "Berdyansk", nameUk: "Бердянськ", lat: 46.7562, lon: 36.7876, oblast: "Zaporizhzhia" },
  pavlohrad: { name: "Pavlohrad", nameUk: "Павлоград", lat: 48.5299, lon: 35.8711, oblast: "Dnipropetrovsk" },
  konotop: { name: "Konotop", nameUk: "Конотоп", lat: 51.242, lon: 33.2037, oblast: "Sumy" },
  shostka: { name: "Shostka", nameUk: "Шостка", lat: 51.8631, lon: 33.4862, oblast: "Sumy" },
  uman: { name: "Uman", nameUk: "Умань", lat: 48.7484, lon: 30.2218, oblast: "Cherkasy" },
  izmail: { name: "Izmail", nameUk: "Ізмаїл", lat: 45.3507, lon: 28.8398, oblast: "Odesa" },
  chornomorsk: { name: "Chornomorsk", nameUk: "Чорноморськ", lat: 46.2996, lon: 30.6558, oblast: "Odesa" },
  brovary: { name: "Brovary", nameUk: "Бровари", lat: 50.5113, lon: 30.7901, oblast: "Kyiv" },
  boryspil: { name: "Boryspil", nameUk: "Бориспіль", lat: 50.3544, lon: 30.9554, oblast: "Kyiv" },
  irpin: { name: "Irpin", nameUk: "Ірпінь", lat: 50.5186, lon: 30.2396, oblast: "Kyiv" },
  starokostiantyniv: { name: "Starokostiantyniv", nameUk: "Старокостянтинів", lat: 49.7562, lon: 27.2212, oblast: "Khmelnytskyi" },
  myrhorod: { name: "Myrhorod", nameUk: "Миргород", lat: 49.967, lon: 33.6074, oblast: "Poltava" },
  pryluky: { name: "Pryluky", nameUk: "Прилуки", lat: 50.5908, lon: 32.3874, oblast: "Chernihiv" },
  nizhyn: { name: "Nizhyn", nameUk: "Ніжин", lat: 51.0483, lon: 31.8864, oblast: "Chernihiv" },
  korosten: { name: "Korosten", nameUk: "Коростень", lat: 50.9507, lon: 28.6473, oblast: "Zhytomyr" },
  berdychiv: { name: "Berdychiv", nameUk: "Бердичів", lat: 49.8937, lon: 28.5878, oblast: "Zhytomyr" },
  ochakiv: { name: "Ochakiv", nameUk: "Очаків", lat: 46.6139, lon: 31.5492, oblast: "Mykolaiv" },
  voznesensk: { name: "Voznesensk", nameUk: "Вознесенськ", lat: 47.5628, lon: 31.3323, oblast: "Mykolaiv" },
  shepetivka: { name: "Shepetivka", nameUk: "Шепетівка", lat: 50.1834, lon: 27.0617, oblast: "Khmelnytskyi" },
  chuhuiv: { name: "Chuhuiv", nameUk: "Чугуїв", lat: 49.8356, lon: 36.6853, oblast: "Kharkiv" },
  izium: { name: "Izium", nameUk: "Ізюм", lat: 49.1927, lon: 37.2847, oblast: "Kharkiv" },
  kupiansk: { name: "Kupiansk", nameUk: "Куп'янськ", lat: 49.7126, lon: 37.6186, oblast: "Kharkiv" }
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

export const normalizeUkText = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[’'`]/g, "'")
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

export const findCityInText = (text: string): GeoPoint | null => {
  const normalized = normalizeUkText(text);
  const words = normalized.split(/\s+/).filter(Boolean);

  for (const point of Object.values(UKRAINE_CITIES)) {
    const nameLower = point.nameUk.toLowerCase();
    let root = nameLower;
    if (nameLower.endsWith("а") || nameLower.endsWith("я") || nameLower.endsWith("е") || nameLower.endsWith("о") || nameLower.endsWith("и")) {
      root = nameLower.slice(0, -1);
    } else if (nameLower === "київ") {
      root = "ки";
    } else if (nameLower === "харків") {
      root = "харк";
    }

    const matches = words.some((w) => {
      if (nameLower === "київ") {
        return w.startsWith("київ") || w.startsWith("києв");
      }
      if (nameLower === "харків") {
        return w.startsWith("харків") || w.startsWith("харков");
      }
      return w.startsWith(root);
    });

    if (matches) {
      return point;
    }
  }

  return null;
};

export const findDirectionInText = (text: string): number | null => {
  const normalized = normalizeUkText(text);

  for (const [phrase, deg] of Object.entries(COMPASS_DIRECTIONS)) {
    if (normalized.includes(phrase)) {
      return deg;
    }
  }

  return null;
};
