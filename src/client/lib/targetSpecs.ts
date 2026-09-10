export interface TargetSpecification {
  modelName: string;
  categoryName: string;
  threatLevel: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  color: string;
  warhead: string;
  maxRange: string;
  typicalSpeed: string;
  altitudeCorridor: string;
  altitudeCategory: string;
  guidance: string;
  engine: string;
  rcs: string;
  tacticalRole: string;
  airDefenseCounters: string;
  soundProfile: string;
}

export interface AltitudeAnalysis {
  altitudeM: number;
  flightLevel: string;
  corridorCategory: string;
  corridorBadgeColor: string;
  tacticalDescription: string;
  interceptionZone: string;
}

export function getAltitudeAnalysis(altM: number): AltitudeAnalysis {
  const fl = Math.round(altM * 0.0328084);
  const flightLevel = `FL ${String(fl).padStart(3, "0")}`;

  if (altM < 120) {
    return {
      altitudeM: altM,
      flightLevel,
      corridorCategory: "Гранично мала висота (Terrain-Following)",
      corridorBadgeColor: "#ef4444",
      tacticalDescription:
        "Наднизький політ з огинанням рельєфу, лісосмуг та ярів. Ціль використовує радіогоризонт і рельєфні тіні для приховання від наземних оглядових РЛС.",
      interceptionZone: "Зона вогню мобільних груп ППО (МВГ), кулеметів Browning/ДШК, ЗСУ Gepard"
    };
  }

  if (altM < 450) {
    return {
      altitudeM: altM,
      flightLevel,
      corridorCategory: "Мала тактична висота",
      corridorBadgeColor: "#f97316",
      tacticalDescription:
        "Характерний робочий коридор ударних БПЛА Shahed-136. Достатня висота для автономної навігації при збереженні низької помітності.",
      interceptionZone: "Зенітні самохідні установки (Gepard), ПЗРК (Stinger/Ігла), великокаліберні кулемети"
    };
  }

  if (altM < 3000) {
    return {
      altitudeM: altM,
      flightLevel,
      corridorCategory: "Середня висота польоту",
      corridorBadgeColor: "#eab308",
      tacticalDescription:
        "Впевнене супроводження радіолокаційними станціями ППО. Поза зоною ефективного вогню стрілецької зброї.",
      interceptionZone: "ЗРК малої та середньої дальності (IRIS-T SLS, Crotale, Оса, Бук-М1)"
    };
  }

  if (altM < 8000) {
    return {
      altitudeM: altM,
      flightLevel,
      corridorCategory: "Високий тактичний ешелон",
      corridorBadgeColor: "#38bdf8",
      tacticalDescription:
        "Висотний транзитний коридор. Максимальна дальність радіовидимості для систем раннього виявлення.",
      interceptionZone: "ЗРК середньої та великої дальності (NASAMS, Hawk, С-300)"
    };
  }

  return {
    altitudeM: altM,
    flightLevel,
    corridorCategory: "Стратосферний / Рубіж скиду КАБ",
    corridorBadgeColor: "#818cf8",
    tacticalDescription:
      "Граничні висоти тактичної та стратегічної авіації. Рубіж розгону та скиду авіабомб з УМПК за межами ППО ближнього радіусу.",
    interceptionZone: "Далекобійні комплекси ППО/ПРО (Patriot PAC-2/PAC-3, SAMP/T, F-16 з AIM-120D)"
  };
}

export function getTargetSpecification(
  type: string,
  id: string,
  speedKmh: number,
  altitudeM: number = 180
): TargetSpecification {
  const altAnalysis = getAltitudeAnalysis(altitudeM);

  if (type === "uav") {
    if (speedKmh < 140) {
      return {
        modelName: "ZALA 421 / Supercam S350 / Орлан-10",
        categoryName: "Оперативно-тактичний розвідувальний БПЛА",
        threatLevel: "HIGH",
        color: "#eab308",
        warhead: "Оптика / Тепловізор (Коригування вогню артилерії та КАБ)",
        maxRange: "до 140–180 км",
        typicalSpeed: "90 – 130 км/год",
        altitudeCorridor: "1 000 – 2 500 м",
        altitudeCategory: altAnalysis.corridorCategory,
        guidance: "Завадостійкий супутниковий зв'язок + автономна IMU",
        engine: "Електромотор або тихий бензиновий ДВЗ",
        rcs: "~0.05 м² (малопомітний радіолокаційно)",
        tacticalRole: "Повітряна розвідка, онлайн-коригування ударів, підсвітка лазером",
        airDefenseCounters: "Зенітні FPV-перехоплювачі, ЗРК малої дальності, мобільний РЕБ («Буковель-AD»)",
        soundProfile: "Тихе дзижчання на низьких частотах, важко розпізнати на землі"
      };
    }

    return {
      modelName: "Shahed-136 (Герань-2) / Shahed-131",
      categoryName: "Ударний баражуючий дрон-камікадзе далекої дії",
      threatLevel: "CRITICAL",
      color: "#ef4444",
      warhead: "50–90 кг (Осколково-фугасна ОФБЧ-50 або термобарична ТББЧ-50)",
      maxRange: "1 500 – 2 500 км",
      typicalSpeed: "160 – 195 км/год",
      altitudeCorridor: "50 – 350 м (наднизька, огинання русел річок та ярів)",
      altitudeCategory: altAnalysis.corridorCategory,
      guidance: "CRPA антена «Комета-М» (8-канальний GPS/ГЛОНАСС) + резервний інерціальний блок",
      engine: "ДВЗ Mado MD-550 (2-тактний, 4-циліндровий, 50 к.с.)",
      rcs: "~0.08 м² (композитний вуглепластиковий планер)",
      tacticalRole: "Вибіркове ураження цивільної/енергетичної інфраструктури та виснаження ППО",
      airDefenseCounters: "Мобільні вогневі групи (кулемети Browning M2 / ДШК), ЗСУ Gepard, ЗРК Viktor",
      soundProfile: "Характерний гучний звук двотактного двигуна («мопед» / «бензопила»), чутно за 3-5 км"
    };
  }

  if (type === "bomb") {
    return {
      modelName: "КАБ-500 / КАБ-1500 (УМПК) / УМПБ Д-30СН",
      categoryName: "Керована плануюча авіаційна бомба з крилами УМПК",
      threatLevel: "CRITICAL",
      color: "#ef4444",
      warhead: "500–1 500 кг фугасна ОФАБ / бетонобійна (ФАБ-500 М-62 з модулем планування)",
      maxRange: "до 65–85 км від рубежу скиду тактичною авіацією Су-34",
      typicalSpeed: "750 – 920 км/год (високошвидкісне планування)",
      altitudeCorridor: "1 200 – 4 500 м (стрімке зниження за глісадою до цілі)",
      altitudeCategory: altAnalysis.corridorCategory,
      guidance: "Завадостійкий модуль супутникової навігації «Комета-М» (CRPA) + інерціальний блок",
      engine: "Відсутній (аеродинамічні розкривні плануючі крила та хвостові рулі)",
      rcs: "~0.3 – 0.5 м² (складна для знищення масивна ціль)",
      tacticalRole: "Руйнування фортифікацій, опорних пунктів та об'єктів прифронтової інфраструктури",
      airDefenseCounters: "ЗРК дальньої дії (Patriot PAC-2, SAMP/T, F-16 з AIM-120) по літаку-носію Су-34; тактичний РЕБ",
      soundProfile: "Характерний наростаючий оглушливий реактивний свист оперення під час пікірування"
    };
  }

  if (type === "fpv") {
    return {
      modelName: "Ударний тактичний FPV-дрон камікадзе (7-10 дюймів)",
      categoryName: "Високоманеврений ударний тактичний квадрокоптер",
      threatLevel: "HIGH",
      color: "#d946ef",
      warhead: "1.5–3.5 кг (кумулятивна граната ПГ-7ВР, пластид, кумулятивний заряд)",
      maxRange: "12 – 22 км (до 25 км з оптоволоконною лінією зв'язку)",
      typicalSpeed: "90 – 130 км/год (екстремальна динаміка польоту)",
      altitudeCorridor: "15 – 90 м (наднизька висота, огинання рельєфу та посадок)",
      altitudeCategory: altAnalysis.corridorCategory,
      guidance: "Аналогове/цифрове відео з мінімальною затримкою, радіоканал ELRS або оптоволоконна котушка",
      engine: "4 високооборотні безколекторні електромотори",
      rcs: "< 0.01 м² (наднизька ЕПР, практично непомітний для оглядових РЛС)",
      tacticalRole: "Точкове ураження живої сили, техніки, опорних пунктів та перехоплення БПЛА",
      airDefenseCounters: "Окопні комплекси РЕБ («Купол»), портативні глушники, антидронові сітки, дробовики 12-го калібру",
      soundProfile: "Високочастотний різкий пронизливий виск високооборотних пропелерів"
    };
  }

  if (type === "munition") {
    if (speedKmh > 1400) {
      return {
        modelName: "Х-47М2 «Кинджал» / 9-А-7660 (Іскандер-М)",
        categoryName: "Аеробалістична гіперзвукова ракета",
        threatLevel: "CRITICAL",
        color: "#f97316",
        warhead: "500 кг унітарна проникаюча / касетна",
        maxRange: "до 2 000 км",
        typicalSpeed: "до 3 400 – 4 000 км/год (10–12 Маха на розгоні)",
        altitudeCorridor: "до 25–40 км (пікірування на ціль під кутом 80-90°)",
        altitudeCategory: altAnalysis.corridorCategory,
        guidance: "Інерціальна + супутникова корекція + радіолокаційна ГСН",
        engine: "Твердопаливний ракетний двигун високої тяги",
        rcs: "~0.1 – 0.2 м²",
        tacticalRole: "Ураження особливо захищених бункерів, штабів, аеродромів та ППО",
        airDefenseCounters: "Виключно ЗРК Patriot PAC-3 (MSE кінетичний перехоплювач) / SAMP/T",
        soundProfile: "Сверхзвуковий подвійний ударний бавовняний фронт Маха"
      };
    }

    return {
      modelName: "Х-101 / 3М-14 «Калібр» / Іскандер-К (Р-500)",
      categoryName: "Стратегічна низьковисотна крилата ракета",
      threatLevel: "CRITICAL",
      color: "#f97316",
      warhead: "450 кг (проникаюча фугасна або касетна з осколковими суббоєприпасами)",
      maxRange: "2 500 – 5 500 км",
      typicalSpeed: "720 – 900 км/год (дозвуковий марш)",
      altitudeCorridor: "30 – 120 м (екстремально низький політ за радіовисотоміром)",
      altitudeCategory: altAnalysis.corridorCategory,
      guidance: "Оптико-електронна система «Отблеск-У» (DSMAC) + ТЕРКОМ + завадозахищений ГЛОНАСС",
      engine: "Двоконтурний турбореактивний ТРДД-50 / РД-95 (висувний під фюзеляжем)",
      rcs: "~0.01 – 0.05 м² (знижена радіопомітність, фасеточний ніс)",
      tacticalRole: "Точкове ураження стратегічних тилових об'єктів з обходом позицій ППО",
      airDefenseCounters: "Винищувачі F-16 / МіГ-29, ЗРК NASAMS, IRIS-T SLM, мобільні ПЗРК на маршруті",
      soundProfile: "Низький турбореактивний гул реактивного літака, чутний безпосередньо перед прольотом"
    };
  }

  if (type === "helicopter") {
    return {
      modelName: "Ка-52 «Алігатор» / Мі-28Н «Нічний мисливець»",
      categoryName: "Ударний розвідувально-бойовий гелікоптер",
      threatLevel: "HIGH",
      color: "#10b981",
      warhead: "12 ПТРК «Вихор» (кумулятивні 10 км), НАР С-8/С-13, 30-мм автоматична гармата 2А42",
      maxRange: "до 460 км (бойовий радіус 200 км)",
      typicalSpeed: "220 – 310 км/год",
      altitudeCorridor: "15 – 150 м (політ над верхівками дерев, зависання)",
      altitudeCategory: altAnalysis.corridorCategory,
      guidance: "Оптико-прицільна система «Шквал-В» / «Тор» з тепловізором",
      engine: "2 турбовальні ВК-2500 (по 2400 к.с.)",
      rcs: "~2.5 – 3.5 м²",
      tacticalRole: "Штурмова підтримка, полювання на бронетехніку, прикордонне патрулювання",
      airDefenseCounters: "ПЗРК Stinger, Starstreak, RBS-70, FPV-дрони в хвостовий гвинт",
      soundProfile: "Характерний ритмічний низькочастотний ляскіт лопатей співвісного гвинта"
    };
  }

  if (type === "aircraft") {
    if (id.startsWith("adsb-")) {
      return {
        modelName: `Цивільний авіалайнер (${id.slice(5).toUpperCase()})`,
        categoryName: "Міжнародний транзитний авіарейс (ADS-B)",
        threatLevel: "LOW",
        color: "#38bdf8",
        warhead: "Немає (Цивільний комерційний борт)",
        maxRange: "до 12 000 км",
        typicalSpeed: "820 – 940 км/год",
        altitudeCorridor: "9 000 – 12 500 м (FL 300 - FL 410)",
        altitudeCategory: altAnalysis.corridorCategory,
        guidance: "Авіоніка ICAO, Flight Management System (FMS), TCAS II",
        engine: "Турбовентиляторні двигуни CFM56 / GE90 / Trent",
        rcs: "> 25 м² (великий пасажирський планер)",
        tacticalRole: "Міжнародні регулярні перевезення вздовж узгоджених безпечних трас",
        airDefenseCounters: "Контролюється цивільними диспетчерами Євроконтролю та Украероруху",
        soundProfile: "Висотний глухий гул у верхніх шарах атмосфери"
      };
    }

    return {
      modelName: "Су-34М / Су-35С (Носій КАБ з УМПК)",
      categoryName: "Фронтовий тактичний надзвуковий винищувач-бомбардувальник",
      threatLevel: "CRITICAL",
      color: "#38bdf8",
      warhead: "до 8 000 кг (КАБ-500/1500 з УМПК, ракети Х-59МК2, Х-31П, Р-77-1)",
      maxRange: "до 4 000 км (бойовий радіус 1 100 км)",
      typicalSpeed: "900 – 1 400 км/год (до 1 900 км/год на висоті)",
      altitudeCorridor: "9 000 – 12 500 м (висотний рубіж пуску за 60–80 км)",
      altitudeCategory: altAnalysis.corridorCategory,
      guidance: "РЛС з ФАР «Хибины», прицільний комплекс «Платан» + супутникова корекція",
      engine: "2 турбореактивні АЛ-31Ф з форсажними камерами",
      rcs: "~5.0 – 8.0 м²",
      tacticalRole: "Дистанційне скидання плануючих авіабомб УМПК та удари по позиціях ППО",
      airDefenseCounters: "Далекобійні комплекси Patriot PAC-2, винищувачі F-16 з ракетами AIM-120D",
      soundProfile: "Потужний реактивний рев двох форсажних двигунів"
    };
  }

  return {
    modelName: `Повітряна ціль (${id})`,
    categoryName: "Невизначений повітряний об'єкт",
    threatLevel: "MEDIUM",
    color: "#94a3b8",
    warhead: "Невідомо (потребує візуального підтвердження)",
    maxRange: "Не визначено",
    typicalSpeed: `${speedKmh} км/год`,
    altitudeCorridor: `${Math.round(altitudeM)} м`,
    altitudeCategory: altAnalysis.corridorCategory,
    guidance: "Радіолокаційне супроводження",
    engine: "Не ідентифіковано",
    rcs: "Не виміряно",
    tacticalRole: "Повітряний рух у контрольованій зоні",
    airDefenseCounters: "Чергові засоби моніторингу ППО",
    soundProfile: "Невідомо"
  };
}

export function getHeadingVectorDescription(
  lat: number,
  lon: number,
  heading: number
): { directionNameUk: string; compassAbbr: string; forwardSummary: string } {
  const norm = ((heading % 360) + 360) % 360;

  let directionNameUk = "північ";
  let compassAbbr = "N";

  if (norm >= 337.5 || norm < 22.5) {
    directionNameUk = "північ";
    compassAbbr = "N";
  } else if (norm >= 22.5 && norm < 67.5) {
    directionNameUk = "північний схід";
    compassAbbr = "NE";
  } else if (norm >= 67.5 && norm < 112.5) {
    directionNameUk = "схід";
    compassAbbr = "E";
  } else if (norm >= 112.5 && norm < 157.5) {
    directionNameUk = "південний схід";
    compassAbbr = "SE";
  } else if (norm >= 157.5 && norm < 202.5) {
    directionNameUk = "південь";
    compassAbbr = "S";
  } else if (norm >= 202.5 && norm < 247.5) {
    directionNameUk = "південний захід";
    compassAbbr = "SW";
  } else if (norm >= 247.5 && norm < 292.5) {
    directionNameUk = "захід";
    compassAbbr = "W";
  } else {
    directionNameUk = "північний захід";
    compassAbbr = "NW";
  }

  let forwardSummary = `Курс ${Math.round(norm)}° (${compassAbbr}, ${directionNameUk})`;

  if (lat > 48.0 && lat < 51.5 && lon > 29.5 && lon < 32.5) {
    if (norm > 300 || norm < 40) forwardSummary += " • Вектор на Північ / Київщину";
    else if (norm >= 40 && norm <= 140) forwardSummary += " • Вектор на Черкащину / Лівий берег";
    else if (norm > 140 && norm <= 220) forwardSummary += " • Вектор на Південь / Кіровоградщину";
    else forwardSummary += " • Вектор на Житомирщину / Захід";
  } else if (lat < 47.5) {
    if (norm > 315 || norm < 45) forwardSummary += " • Вектор з моря вглиб узбережжя";
    else forwardSummary += " • Маневрування вздовж прибережної зони";
  } else if (lon > 35.0) {
    if (norm > 220 && norm < 320) forwardSummary += " • Вектор зі сходу на Центральну Україну";
  }

  return { directionNameUk, compassAbbr, forwardSummary };
}
