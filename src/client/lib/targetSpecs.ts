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
  isJet?: boolean;
  propulsionSummary?: string;
  detectionSensors?: string;
  launchOrigin?: string;
  tacticalThreatAssessment?: string;
  reactionTimeWindow?: string;
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
  altitudeM: number = 180,
  packetModel?: string,
  packetCallsign?: string
): TargetSpecification {
  const altAnalysis = getAltitudeAnalysis(altitudeM);

  if (type === "uav") {
    const isJetShahed =
      (packetModel && (packetModel.toLowerCase().includes("238") || packetModel.toLowerCase().includes("jet"))) ||
      speedKmh >= 235;

    if (isJetShahed) {
      return {
        modelName: packetModel && packetModel.includes("238") ? packetModel : "Shahed-238 (Реактивний / Jet-Powered)",
        categoryName: "Швидкісний турбореактивний дрон-камікадзе далекої дії",
        threatLevel: "CRITICAL",
        color: "#ef4444",
        warhead: "50 кг (Високобризантна термобарична ТББЧ-50 або осколково-фугасна ОФБЧ-50)",
        maxRange: "1 000 – 1 800 км",
        typicalSpeed: "460 – 580 км/год (турбореактивна тяга, швидкість у 3 рази вища за Shahed-136)",
        altitudeCorridor: "300 – 1 500 м (висотний швидкісний ешелон)",
        altitudeCategory: altAnalysis.corridorCategory,
        guidance: "CRPA антена «Комета-М» (8-канальна) + резервна IMU + оптична/тепловізійна ГСН",
        engine: "Малогабаритний турбореактивний двигун Toloue-10 / TJ100 (без гвинта, вихлопне сопло)",
        rcs: "~0.08 м² (радіопоглинаюче чорне матове композитне покриття RAM)",
        tacticalRole: "Швидкісний прорив рубежів МВГ (мобільні вогневі групи фізично не встигають навестись) та ураження пріоритетних об'єктів",
        airDefenseCounters: "Виключно ЗРК середнього/малого радіусу (IRIS-T, NASAMS, Бук-М1) та винищувачі F-16 / МіГ-29",
        soundProfile: "Високочастотний наростаючий свист реактивної турбіни (відмінний від звуку поршневого «мопеда»)",
        isJet: true,
        propulsionSummary: "🔥 Турбореактивний двигун ТРД • Реактивне сопло • Швидкість ~510 км/год • Пропелер відсутній",
        detectionSensors: "РЛС огляду ППО ЗСУ + мережа акустичних сенсорів «Звук» (високочастотний спектр реактивної турбіни)",
        launchOrigin: "Полігон Чауда (ТОТ Крим) / Приморсько-Ахтарськ / Курська обл. (РФ)",
        tacticalThreatAssessment: "Критична загроза. Через швидкість ~500 км/год час на реакцію ППО скорочено до < 90 секунд на сектор. Вогонь кулеметних груп неефективний.",
        reactionTimeWindow: "< 1.5 хв на сектор (висока швидкість наближення)"
      };
    }

    const isRecon =
      (packetModel && (packetModel.includes("Orlan") || packetModel.includes("Supercam") || packetModel.includes("ZALA") || packetModel.includes("Recon"))) ||
      (!packetModel && speedKmh < 140);

    if (isRecon) {
      return {
        modelName: packetModel || "ZALA 421 / Supercam S350 / Орлан-10",
        categoryName: "Оперативно-тактичний розвідувальний БПЛА",
        threatLevel: "HIGH",
        color: "#eab308",
        warhead: "Оптико-електронна розвідувальна станція (Full HD / тепловізор / лазерний далекомір)",
        maxRange: "до 140–180 км",
        typicalSpeed: "90 – 130 км/год",
        altitudeCorridor: "1 000 – 2 500 м",
        altitudeCategory: altAnalysis.corridorCategory,
        guidance: "Завадостійкий супутниковий зв'язок + автономний автопілот",
        engine: "Електродвигун або тихий бензиновий ДВЗ з тягнучим гвинтом",
        rcs: "~0.05 м² (малопомітний радіолокаційно)",
        tacticalRole: "Повітряна розвідка, онлайн-коригування ударів КАБ, РСЗВ та важкої артилерії",
        airDefenseCounters: "Зенітні FPV-перехоплювачі, ЗРК малої дальності (Osa, Crotale, Стріла-10), комплекси РЕБ («Буковель-AD»)",
        soundProfile: "Майже безшумний на робочій висоті понад 1000 м, тихе дзижчання на землі",
        isJet: false,
        propulsionSummary: "🔋 Електромотор / тихий ДВЗ • Тягнучий гвинт • Швидкість ~110 км/год • Оптичний підвіс",
        detectionSensors: "РЛС огляду повітряного простору + оптичні станції спостереження",
        launchOrigin: "Прикордонні та прифронтові райони пуску катапультного типу (< 40 км від лінії фронту)",
        tacticalThreatAssessment: "Високий пріоритет на знищення: безпосередньо наводить та коригує удари авіабомб КАБ та ракет.",
        reactionTimeWindow: "Баражування у секторі (15 – 35 хв)"
      };
    }

    return {
      modelName: packetModel || "Shahed-136 (Герань-2 / Поршневий)",
      categoryName: "Поршневий баражуючий дрон-камікадзе далекої дії",
      threatLevel: "CRITICAL",
      color: "#ef4444",
      warhead: "50–90 кг (Осколково-фугасна ОФБЧ-50 або термобарична ТББЧ-50)",
      maxRange: "1 500 – 2 500 км",
      typicalSpeed: "160 – 195 км/год (поршнева тяга)",
      altitudeCorridor: "50 – 350 м (наднизька, огинання русел річок та ярів)",
      altitudeCategory: altAnalysis.corridorCategory,
      guidance: "CRPA антена «Комета-М» (8-канальний GPS/ГЛОНАСС) + резервний інерціальний блок",
      engine: "Поршневий ДВЗ Mado MD-550 (2-тактний, 4-циліндровий, 50 к.с.) + штовхаючий 2-лопатевий пропелер",
      rcs: "~0.08 м² (композитний планер)",
      tacticalRole: "Вибіркове ураження цивільної/енергетичної інфраструктури, виснаження та перевантаження ППО",
      airDefenseCounters: "Мобільні вогневі групи (кулемети Browning M2 / ДШК, прожектори, тепловізори), ЗСУ Gepard, ЗРК Viktor",
      soundProfile: "Характерний гучний низькочастотний звук 2-тактного двигуна («мопед» / «бензопила»), чутно за 3–5 км",
      isJet: false,
      propulsionSummary: "⚙️ Поршневий ДВЗ MD-550 (50 к.с.) • Штовхаючий гвинт на хвості • Швидкість ~185 км/год • Звук «мопед»",
      detectionSensors: "Акустична мережа «Звук» (виявлення за звуком мопеда) + мобільні пости «єППО» + РЛС низьких висот",
      launchOrigin: "Приморсько-Ахтарськ (Краснодарський край) / мис Чауда (Крим) / Курськ / Орел",
      tacticalThreatAssessment: "Низьковисотний політ з огинанням рельєфу. Основний засіб знищення — мобільні вогневі групи (МВГ) та зенітні гармати Gepard.",
      reactionTimeWindow: "3.5 – 6 хв на сектор (дозвуковий поршневий темп)"
    };
  }

  if (type === "bomb") {
    return {
      modelName: packetModel || "КАБ-500 / КАБ-1500 (УМПК) / УМПБ Д-30СН",
      categoryName: "Керована плануюча авіаційна бомба з крилами УМПК",
      threatLevel: "CRITICAL",
      color: "#ef4444",
      warhead: "500–1 500 кг фугасна ОФАБ / бетонобійна (ФАБ-500 М-62 з модулем планування)",
      maxRange: "до 65–85 км від рубежу скиду тактичною авіацією Су-34",
      typicalSpeed: "750 – 920 км/год (високошвидкісне безмоторне планування)",
      altitudeCorridor: "1 200 – 4 500 м (стрімке зниження за глісадою до цілі)",
      altitudeCategory: altAnalysis.corridorCategory,
      guidance: "Завадостійкий модуль супутникової навігації «Комета-М» (CRPA) + інерціальний блок",
      engine: "Відсутній (аеродинамічні розкривні плануючі крила та хвостові рулі)",
      rcs: "~0.3 – 0.5 м² (складна для знищення масивна ціль)",
      tacticalRole: "Руйнування фортифікацій, опорних пунктів та об'єктів прифронтової інфраструктури",
      airDefenseCounters: "ЗРК дальньої дії (Patriot PAC-2, SAMP/T, F-16 з AIM-120) по літаку-носію Су-34 до рубежу скиду",
      soundProfile: "Характерний наростаючий оглушливий реактивний свист оперення під час пікірування",
      isJet: false,
      propulsionSummary: "🪂 Безмоторне плануюче крило УМПК • Глісада пікірування • Швидкість ~850 км/год",
      detectionSensors: "РЛС дального радіолокаційного виявлення (засічка скиду з винищувача Су-34)",
      launchOrigin: "Рубіж скиду Су-34 над Бєлгородською / Курською обл. / ТОТ (висота 10–12 км, віддалення 65–80 км)",
      tacticalThreatAssessment: "Масивна фугасна міць (до 1500 кг). Знищення самої бомби у повітрі вкрай ускладнене; єдиний надійний засіб — знищення або відтискання носія Су-34.",
      reactionTimeWindow: "60 – 110 секунд від моменту скиду до удару"
    };
  }

  if (type === "fpv") {
    return {
      modelName: packetModel || "Ударний тактичний FPV-дрон камікадзе (7-10 дюймів)",
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
      soundProfile: "Високочастотний різкий пронизливий виск високооборотних пропелерів",
      isJet: false,
      propulsionSummary: "⚡ 4 безколекторні електродвигуни • Квадрокоптер • Швидкість ~110 км/год",
      detectionSensors: "Радіочастотні сканери («Цукорок»), аналізатори відеоканалів 5.8 GHz",
      launchOrigin: "Передові позиції та бліндажі противника на лінії зіткнення (< 15 км)",
      tacticalThreatAssessment: "Безпосередня небезпека на передовій. Протидія: окопний РЕБ, сітки, дробовики.",
      reactionTimeWindow: "30 – 60 секунд у зоні прямої видимості"
    };
  }

  if (type === "munition") {
    if (packetModel && (packetModel.includes("Кинжал") || packetModel.includes("Іскандер-М") || speedKmh > 1400)) {
      return {
        modelName: packetModel || "Х-47М2 «Кинджал» / 9-А-7660 (Іскандер-М)",
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
        tacticalRole: "Ураження особливо захищених бункерів, штабів, аеродромів та систем ППО",
        airDefenseCounters: "Виключно ЗРК Patriot PAC-3 (MSE кінетичний перехоплювач) / SAMP/T",
        soundProfile: "Сверхзвуковий подвійний ударний бавовняний фронт Маха",
        isJet: true,
        propulsionSummary: "⚡ Твердопаливний ракетний двигун • Гіперзвук до 10–12 Мах • Балістична дуга",
        detectionSensors: "РЛС раннього попередження про ракетний напад",
        launchOrigin: "Винищувачі МіГ-31К (з району Саваслейка/Рязань) або ОТРК «Іскандер-М»",
        tacticalThreatAssessment: "Аеробалістична ціль, пікірування на швидкості > 3000 км/год. Перехоплення можливе виключно Patriot PAC-3.",
        reactionTimeWindow: "< 40 секунд на кінцевому ешелоні перехоплення"
      };
    }

    return {
      modelName: packetModel || "Х-101 / 3М-14 «Калібр» / Іскандер-К (Р-500)",
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
      soundProfile: "Низький турбореактивний гул реактивного літака, чутний безпосередньо перед прольотом",
      isJet: true,
      propulsionSummary: "🚀 Турбореактивний двигун ТРДД-50 / РД-95 • Швидкість ~820 км/год • Дозвуковий марш",
      detectionSensors: "Загальнонаціональна радіолокаційна мережа ППО + спостережні пости",
      launchOrigin: "Стратегічні ракетоносці Ту-95МС (Каспій/Енгельс) або кораблі ЧФ РФ",
      tacticalThreatAssessment: "Низьковисотний політ (30–80 м) зі складною траєкторією обходу позицій ППО.",
      reactionTimeWindow: "1 – 2 хвилини на перехоплення у зоні дії комплексу ППО"
    };
  }

  if (type === "helicopter") {
    return {
      modelName: packetModel || "Ка-52 «Алігатор» / Мі-28Н «Нічний мисливець»",
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
      soundProfile: "Характерний ритмічний низькочастотний ляскіт лопатей співвісного гвинта",
      isJet: false,
      propulsionSummary: "🚁 2 турбовальні двигуни ВК-2500 • Співвісні гвинти • Швидкість ~260 км/год",
      detectionSensors: "РЛС огляду низьких висот + оптико-електронні комплекси",
      launchOrigin: "Передові майданчики підскоку (Ростовська/Бєлгородська обл. / ТОТ Крим)",
      tacticalThreatAssessment: "Штурмова підтримка та пуски ПТРК з дистанції 8–10 км.",
      reactionTimeWindow: "2 – 4 хвилини у зоні радіовидимості"
    };
  }

  if (type === "aircraft") {
    if (id.startsWith("adsb-") || packetCallsign || (packetModel && !packetModel.includes("Су-"))) {
      const displayModel = packetModel || `Цивільний авіалайнер (${id.slice(5).toUpperCase()})`;
      return {
        modelName: packetCallsign ? `${displayModel} [${packetCallsign}]` : displayModel,
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
        soundProfile: "Висотний глухий гул у верхніх шарах атмосфери",
        isJet: true,
        propulsionSummary: "✈️ Турбовентиляторні двигуни цивільної авіації • Безпечний транзит",
        detectionSensors: "Транспондер ADS-B (Mode S / 1090 MHz) + диспетчерські РЛС Eurocontrol",
        launchOrigin: "Міжнародні аеропорти Європи",
        tacticalThreatAssessment: "Безпечний комерційний рейс у міжнародному узгодженому повітряному коридорі.",
        reactionTimeWindow: "Штатний контрольований політ"
      };
    }

    return {
      modelName: packetModel || "Су-34М / Су-35С (Носій КАБ з УМПК)",
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
      soundProfile: "Потужний реактивний рев двох форсажних двигунів",
      isJet: true,
      propulsionSummary: "⚡ 2 турбореактивні форсажні двигуни АЛ-31Ф • Швидкість до 1 900 км/год",
      detectionSensors: "РЛС дального радіолокаційного виявлення ППО ЗСУ",
      launchOrigin: "Авіабази ПКС РФ («Балтимор» Воронеж, «Шайковка», «Морозовськ»)",
      tacticalThreatAssessment: "Носій плануючих авіабомб КАБ з УМПК та ракет Х-59МК2. Пріоритетна ціль для Patriot PAC-2.",
      reactionTimeWindow: "1 – 3 хвилини до виходу на рубіж пуску"
    };
  }

  return {
    modelName: packetModel || `Повітряна ціль (${id})`,
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
    soundProfile: "Невідомо",
    propulsionSummary: "📡 Радіолокаційний контакт • Телеметрія уточнюється",
    detectionSensors: "Радіолокаційна мережа раннього виявлення",
    launchOrigin: "Сектор уточнюється",
    tacticalThreatAssessment: "Ціль на супроводженні черговими засобами ППО.",
    reactionTimeWindow: "Контрольоване супроводження"
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
