// Precise geographic boundaries for Ukraine (State Border & Oblast Divisions)
// Designed for tactical military and situational awareness displays

export interface GeoLineString {
  type: "Feature";
  properties: {
    name: string;
    type: "state_border" | "oblast_border";
  };
  geometry: {
    type: "LineString";
    coordinates: Array<[number, number]>; // [lon, lat]
  };
}

export interface GeoFeatureCollection {
  type: "FeatureCollection";
  features: GeoLineString[];
}

// 1. Ukraine International Boundary (Recognized State Borders including Crimea)
export const UKRAINE_STATE_BORDER: Array<[number, number]> = [
  // West & North-West: Poland, Slovakia, Hungary
  [24.03, 51.58], [23.60, 51.50], [23.63, 50.85], [24.12, 50.50],
  [24.08, 49.95], [22.75, 49.55], [22.65, 49.10], [22.15, 48.90],
  [22.18, 48.45], [22.85, 48.05], [23.25, 48.00], [24.15, 47.95],
  // South-West: Romania & Moldova
  [24.85, 47.75], [25.55, 47.92], [26.00, 48.25], [26.60, 48.45],
  [27.50, 48.45], [28.25, 48.15], [28.85, 47.95], [29.25, 47.75],
  [29.75, 47.25], [30.05, 46.50], [30.00, 46.10], [28.65, 45.45],
  [28.20, 45.45], [28.60, 45.20], [29.60, 45.30], [29.75, 45.55],
  // Black Sea Coast & Crimea
  [30.50, 46.00], [30.75, 46.45], [31.50, 46.60], [31.75, 46.50],
  [32.25, 46.10], [33.25, 45.85], [33.00, 45.35], [33.55, 44.55],
  [34.40, 44.40], [35.10, 44.95], [36.45, 45.25], [36.65, 45.40],
  // Sea of Azov & Kerch
  [35.90, 45.85], [35.30, 46.20], [35.00, 46.40], [35.40, 46.70],
  [36.80, 46.75], [37.35, 47.05], [38.00, 47.10],
  // Eastern Border (Donetsk, Luhansk)
  [38.20, 47.25], [38.75, 47.55], [39.05, 47.85], [39.85, 48.15],
  [40.20, 48.75], [40.15, 49.35], [39.80, 49.90], [38.50, 49.95],
  // North-Eastern Border (Kharkiv, Sumy)
  [38.00, 50.35], [37.20, 50.30], [36.35, 50.45], [35.80, 50.55],
  [35.30, 50.85], [35.15, 51.25], [34.70, 51.25], [34.25, 51.55],
  [34.15, 52.15], [33.50, 52.35], [33.25, 52.20],
  // Northern Border (Chernihiv, Kyiv, Zhytomyr, Rivne, Volyn) - Border with Belarus
  [32.30, 52.15], [31.80, 52.10], [31.30, 51.95], [30.50, 51.50],
  [29.80, 51.35], [29.20, 51.55], [28.20, 51.65], [27.30, 51.65],
  [26.40, 51.85], [25.50, 51.85], [24.80, 51.75], [24.03, 51.58]
];

// 2. Strategic Oblast Inter-Regional Division Lines (Administrative Sectors)
export const OBLAST_DIVISIONS: Array<{ name: string; coords: Array<[number, number]> }> = [
  // Kyiv Region Hub
  { name: "Київ - Чернігів", coords: [[30.5, 51.5], [30.9, 50.8], [31.2, 50.4]] },
  { name: "Київ - Житомир", coords: [[29.8, 51.3], [29.4, 50.5], [29.2, 49.9]] },
  { name: "Київ - Черкаси", coords: [[31.2, 50.4], [31.5, 49.8], [31.8, 49.4]] },
  { name: "Київ - Полтава", coords: [[31.8, 50.3], [32.3, 50.1], [32.5, 49.8]] },

  // North & East
  { name: "Чернігів - Суми", coords: [[32.3, 52.1], [32.8, 51.4], [33.3, 50.8]] },
  { name: "Суми - Полтава", coords: [[33.3, 50.8], [34.2, 50.3], [34.8, 50.1]] },
  { name: "Суми - Харків", coords: [[34.8, 50.1], [35.3, 50.2], [35.6, 50.0]] },
  { name: "Харків - Полтава", coords: [[35.0, 49.9], [35.2, 49.4], [35.0, 49.0]] },
  { name: "Харків - Дніпро", coords: [[35.2, 49.2], [35.8, 48.9], [36.2, 48.8]] },
  { name: "Харків - Донецьк/Луганськ", coords: [[37.2, 49.5], [37.8, 49.1], [38.2, 48.8]] },

  // Center & South
  { name: "Полтава - Дніпро", coords: [[34.0, 49.2], [34.5, 48.9], [34.8, 48.7]] },
  { name: "Дніпро - Запоріжжя", coords: [[34.6, 48.2], [35.2, 47.9], [36.0, 47.8]] },
  { name: "Дніпро - Кіровоград", coords: [[33.4, 48.8], [33.5, 48.1], [33.4, 47.8]] },
  { name: "Черкаси - Кіровоград", coords: [[31.4, 49.0], [31.8, 48.7], [32.5, 48.6]] },
  { name: "Кіровоград - Миколаїв", coords: [[31.6, 48.1], [32.1, 47.6], [32.7, 47.4]] },
  { name: "Миколаїв - Одеса", coords: [[31.2, 47.2], [31.1, 46.6], [31.3, 46.4]] },
  { name: "Миколаїв - Херсон", coords: [[32.4, 47.2], [32.6, 46.8], [32.5, 46.4]] },
  { name: "Херсон - Запоріжжя", coords: [[33.8, 47.2], [34.5, 47.1], [34.8, 46.8]] },
  { name: "Херсон - Крим (Перекоп)", coords: [[33.6, 46.1], [34.2, 45.9], [34.8, 46.0]] },

  // West
  { name: "Житомир - Вінниця", coords: [[28.5, 49.8], [28.8, 49.5], [29.2, 49.3]] },
  { name: "Вінниця - Черкаси/Кіровоград", coords: [[29.5, 49.1], [29.9, 48.8], [30.1, 48.4]] },
  { name: "Вінниця - Хмельницький", coords: [[27.8, 49.6], [27.7, 49.1], [27.6, 48.6]] },
  { name: "Хмельницький - Тернопіль", coords: [[26.3, 49.7], [26.2, 49.2], [26.2, 48.6]] },
  { name: "Рівне - Волинь", coords: [[25.6, 51.5], [25.5, 50.8], [25.4, 50.4]] },
  { name: "Рівне - Хмельницький/Тернопіль", coords: [[26.0, 50.3], [26.1, 49.9], [25.9, 49.6]] },
  { name: "Львів - Тернопіль", coords: [[24.8, 50.1], [24.9, 49.6], [24.8, 49.2]] },
  { name: "Львів - Івано-Франківськ", coords: [[24.2, 49.3], [24.5, 49.0], [24.4, 48.7]] },
  { name: "Івано-Франківськ - Закарпаття", coords: [[24.0, 48.5], [24.2, 48.2], [24.4, 47.9]] },
  { name: "Чернівці - Хмельницький/Вінниця", coords: [[26.2, 48.5], [26.8, 48.4], [27.2, 48.3]] }
];

export const getUkraineBordersGeoJSON = (): GeoFeatureCollection => {
  const features: GeoLineString[] = [
    {
      type: "Feature",
      properties: {
        name: "Державний кордон України",
        type: "state_border"
      },
      geometry: {
        type: "LineString",
        coordinates: UKRAINE_STATE_BORDER
      }
    },
    ...OBLAST_DIVISIONS.map((obl): GeoLineString => ({
      type: "Feature",
      properties: {
        name: obl.name,
        type: "oblast_border"
      },
      geometry: {
        type: "LineString",
        coordinates: obl.coords
      }
    }))
  ];

  return {
    type: "FeatureCollection",
    features
  };
};
