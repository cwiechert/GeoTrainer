"use strict";

/* ------------------------------------------------------------------ *
 * GeoTrainer — quiz de geografía
 * Datos: data.js (window.COUNTRIES) + assets.js (window.ASSETS) generados
 * desde el dataset abierto mledoze/countries, mapsicon y Wikipedia.
 * Banderas: imágenes de flagcdn.com. Recursos visuales: carpeta assets/.
 * ------------------------------------------------------------------ */

const FLAG_URL = (cca2) => `https://flagcdn.com/w320/${cca2}.png`;
const ASSETS = window.ASSETS || { silhouettes: {}, landmarks: {} };
const WM = window.WORLDMAP || { w: 0, h: 0, c: {} };

const REGIONS = [
  { key: "Africa", label: "África" },
  { key: "Americas", label: "América" },
  { key: "Asia", label: "Asia" },
  { key: "Europe", label: "Europa" },
  { key: "Oceania", label: "Oceanía" },
];
const REGION_LABELS = Object.fromEntries(REGIONS.map((r) => [r.key, r.label]));

// Idiomas demasiado obscuros (criollos, lenguas de señas, hiperlocales) que no
// usamos como respuesta ni como distractor para que la pregunta sea justa.
const LANG_BLACKLIST = new Set([
  "arc", "bis", "bjz", "bwg", "crs", "gil", "gsw", "hat", "her", "hgm",
  "hif", "hmo", "jam", "kck", "khi", "kwn", "lat", "loz", "lua", "mah", "mfe",
  "nau", "ndc", "ndo", "nzs", "pau", "pov", "roh", "sag", "smi", "tet", "toi",
  "tpi", "tvl", "zdj", "zib",
]);

// Metadatos de cada tipo de pregunta (etiqueta visible, icono y color del badge)
const QUESTION_TYPES = {
  "capital-to-country": { label: "Capital → País", icon: "🏙️", color: "#56ccf2" },
  "country-to-capital": { label: "País → Capital", icon: "🏛️", color: "#a78bfa" },
  "flag-to-country": { label: "Bandera → País", icon: "🏳️", color: "#fbbf24" },
  "country-to-flag": { label: "País → Bandera", icon: "🚩", color: "#fb923c" },
  "country-to-region": { label: "País → Continente", icon: "🗺️", color: "#34d399" },
  "currency-to-country": { label: "Moneda → País", icon: "💰", color: "#f472b6" },
  "country-to-language": { label: "País → Idioma", icon: "💬", color: "#a3e635" },
  "silhouette-to-country": { label: "Silueta → País", icon: "🧩", color: "#2dd4bf" },
  "map-location-to-country": { label: "Ubicación → País", icon: "📍", color: "#f87171" },
  "landmark-to-country": { label: "Monumento → País", icon: "🗽", color: "#818cf8" },
};

// Al responder, revelar en cada alternativa el dato relacionado con la pregunta:
//   "capital"  → la opción es un país → su capital
//   "country"  → la opción es una capital → su país
//   "currency" → la opción es un país → su moneda
//   "flag"     → la opción es un país → su bandera (imagen)
const OPTION_HINT = {
  "capital-to-country": "capital",
  "flag-to-country": "flag",
  "currency-to-country": "currency",
  "silhouette-to-country": "capital",
  "map-location-to-country": "capital",
  "country-to-capital": "country",
};

const state = {
  all: [],
  pool: [],                                  // países según continentes elegidos
  selectedRegions: new Set(REGIONS.map((r) => r.key)),
  selectedTypes: new Set(),                  // se inicializa con los tipos disponibles
  availableTypes: [],
  langNames: [],                             // idiomas reconocibles (para distractores)
  current: null,
  answered: false,
  score: 0,
  total: 0,
  streak: 0,
};

const el = {
  controls: document.getElementById("controls"),
  card: document.getElementById("card"),
  qbadge: document.getElementById("qbadge"),
  prompt: document.getElementById("prompt"),
  visual: document.getElementById("visual"),
  options: document.getElementById("options"),
  feedback: document.getElementById("feedback"),
  nextBtn: document.getElementById("nextBtn"),
  score: document.getElementById("score"),
  accuracy: document.getElementById("accuracy"),
  streak: document.getElementById("streak"),
};

/* ---------------------------- utilidades --------------------------- */

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const sample = (arr, n) => shuffle(arr).slice(0, n);

// candidatos para formatos que dependen de recursos
const majorLangs = (c) => c.languages.filter((l) => !LANG_BLACKLIST.has(l.code));
const languageCandidates = () => state.pool.filter((c) => majorLangs(c).length > 0);
const silhouetteCandidates = () => state.pool.filter((c) => ASSETS.silhouettes[c.cca2]);
const landmarkCandidates = () => state.pool.filter((c) => ASSETS.landmarks[c.cca2]);
// países con forma vectorial utilizable (excluye los que cruzan el antimeridiano)
const mapCandidates = () => state.pool.filter((c) => WM.c[c.cca2] && !WM.c[c.cca2].x);

/* --------------------- dropdown multiselección --------------------- */

function makeDropdown({ label, items, selected, allLabel, summarize, onChange }) {
  const root = document.createElement("div");
  root.className = "dropdown";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "dropdown-btn";
  btn.setAttribute("aria-haspopup", "true");
  btn.setAttribute("aria-expanded", "false");
  btn.innerHTML =
    `<span class="dd-label">${label}</span>` +
    `<span class="dd-value"></span>` +
    `<span class="dd-caret" aria-hidden="true">▾</span>`;
  const valueEl = btn.querySelector(".dd-value");

  const panel = document.createElement("div");
  panel.className = "dropdown-panel";
  panel.hidden = true;

  const master = document.createElement("label");
  master.className = "dd-option master";
  const masterBox = document.createElement("input");
  masterBox.type = "checkbox";
  master.append(masterBox, document.createTextNode("Todos"));
  panel.appendChild(master);
  panel.appendChild(Object.assign(document.createElement("div"), { className: "dd-divider" }));

  const boxes = items.map((item) => {
    const opt = document.createElement("label");
    opt.className = "dd-option";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.value = item.value;
    box.checked = selected.has(item.value);
    opt.append(box, document.createTextNode(item.label));
    panel.appendChild(opt);
    box.addEventListener("change", () => {
      box.checked ? selected.add(item.value) : selected.delete(item.value);
      refresh();
      onChange();
    });
    return box;
  });

  masterBox.addEventListener("change", () => {
    if (masterBox.checked) items.forEach((i) => selected.add(i.value));
    else selected.clear();
    boxes.forEach((b) => (b.checked = selected.has(b.value)));
    refresh();
    onChange();
  });

  function refresh() {
    const n = selected.size;
    const total = items.length;
    masterBox.checked = n === total;
    masterBox.indeterminate = n > 0 && n < total;
    if (n === total) valueEl.textContent = allLabel;
    else if (n === 0) valueEl.textContent = "Ninguno";
    else if (n === 1) valueEl.textContent = items.find((i) => selected.has(i.value)).label;
    else valueEl.textContent = summarize(n, total);
  }

  function toggle(open) {
    const isOpen = open ?? panel.hidden;
    panel.hidden = !isOpen;
    root.classList.toggle("open", isOpen);
    btn.setAttribute("aria-expanded", String(isOpen));
  }
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    closeAllDropdowns(root);
    toggle();
  });
  panel.addEventListener("click", (e) => e.stopPropagation());
  root._close = () => toggle(false);

  root.append(btn, panel);
  refresh();
  return root;
}

function closeAllDropdowns(except) {
  document.querySelectorAll(".dropdown").forEach((d) => {
    if (d !== except && d._close) d._close();
  });
}
document.addEventListener("click", () => closeAllDropdowns());
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeAllDropdowns();
});

function buildControls() {
  const continents = makeDropdown({
    label: "Continentes",
    items: REGIONS.map((r) => ({ value: r.key, label: r.label })),
    selected: state.selectedRegions,
    allLabel: "Todos",
    summarize: (n) => `${n} continentes`,
    onChange: () => {
      applyRegionFilter();
      newQuestion();
    },
  });

  const types = makeDropdown({
    label: "Preguntas",
    items: state.availableTypes.map((value) => ({
      value,
      label: `${QUESTION_TYPES[value].icon}  ${QUESTION_TYPES[value].label}`,
    })),
    selected: state.selectedTypes,
    allLabel: "Todos los tipos",
    summarize: (n) => `${n} tipos`,
    onChange: () => newQuestion(),
  });

  el.controls.append(continents, types);
}

/* ----------------------- generador de preguntas -------------------- */

// 4 distractores (nombres de países del pool actual) + el correcto
function buildNameOptions(country, pool) {
  const distractors = sample(
    pool.filter((x) => x.name !== country.name).map((x) => x.name),
    4
  );
  return shuffle([country.name, ...distractors]);
}

const FORMATS = {
  "capital-to-country": () => {
    const c = pick(state.pool);
    return {
      prompt: `¿A qué país pertenece la capital <span class="highlight">${c.capital}</span>?`,
      correct: c.name,
      options: buildNameOptions(c, state.pool),
    };
  },

  "country-to-capital": () => {
    const c = pick(state.pool);
    const distractors = sample(
      state.pool.filter((x) => x.capital !== c.capital).map((x) => x.capital),
      4
    );
    return {
      prompt: `¿Cuál es la capital de <span class="highlight">${c.name}</span>?`,
      correct: c.capital,
      options: shuffle([c.capital, ...distractors]),
    };
  },

  "flag-to-country": () => {
    const c = pick(state.pool);
    return {
      prompt: "¿De qué país es esta bandera?",
      image: { src: FLAG_URL(c.cca2), alt: `Bandera de ${c.name}`, kind: "flag" },
      correct: c.name,
      options: buildNameOptions(c, state.pool),
    };
  },

  "country-to-flag": () => {
    const c = pick(state.pool);
    const distractors = sample(state.pool.filter((x) => x.cca2 !== c.cca2), 4);
    return {
      prompt: `¿Cuál es la bandera de <span class="highlight">${c.name}</span>?`,
      correct: c.name,
      options: shuffle([c, ...distractors]).map((x) => ({ value: x.name, flag: x.cca2 })),
      optionStyle: "flag",
    };
  },

  "country-to-region": () => {
    const c = pick(state.pool);
    return {
      prompt: `¿En qué continente está <span class="highlight">${c.name}</span>?`,
      correct: REGION_LABELS[c.region],
      options: shuffle(REGIONS.map((r) => r.label)),
    };
  },

  "currency-to-country": () => {
    // Distractores que NO comparten moneda con el correcto → respuesta única.
    const c = pick(state.pool.filter((x) => x.currencies.length > 0));
    const codes = new Set(c.currencies.map((m) => m.code));
    const distractors = sample(
      state.all.filter(
        (x) => x.name !== c.name && !x.currencies.some((m) => codes.has(m.code))
      ),
      4
    ).map((x) => x.name);
    return {
      prompt: `¿Qué país usa la moneda <span class="highlight">${c.currencies[0].name}</span>?`,
      correct: c.name,
      options: shuffle([c.name, ...distractors]),
    };
  },

  "country-to-language": () => {
    const c = pick(languageCandidates());
    const correctLang = pick(majorLangs(c));
    const own = new Set(c.languages.map((l) => l.name));
    const distractors = sample(state.langNames.filter((n) => !own.has(n)), 4);
    return {
      prompt: `¿Qué idioma se habla en <span class="highlight">${c.name}</span>?`,
      correct: correctLang.name,
      options: shuffle([correctLang.name, ...distractors]),
    };
  },

  "silhouette-to-country": () => {
    const c = pick(silhouetteCandidates());
    return {
      prompt: "¿A qué país pertenece esta silueta?",
      image: { src: `assets/silhouettes/${c.cca2}.svg`, alt: `Silueta de ${c.name}`, kind: "silhouette" },
      correct: c.name,
      options: buildNameOptions(c, state.pool),
    };
  },

  "map-location-to-country": () => {
    const c = pick(mapCandidates());
    return {
      prompt: "¿Qué país está resaltado en el mapa?",
      mapShape: c.cca2,
      correct: c.name,
      options: buildNameOptions(c, state.pool),
    };
  },

  "landmark-to-country": () => {
    const c = pick(landmarkCandidates());
    const lm = ASSETS.landmarks[c.cca2];
    return {
      prompt: "¿En qué país está este monumento?",
      image: { src: lm.file, alt: lm.name, kind: "landmark" },
      correct: c.name,
      options: buildNameOptions(c, state.pool),
      note: lm.name,
    };
  },
};

function formatUsable(type) {
  switch (type) {
    case "silhouette-to-country":
      return silhouetteCandidates().length >= 1 && state.pool.length >= 5;
    case "landmark-to-country":
      return landmarkCandidates().length >= 1 && state.pool.length >= 5;
    case "map-location-to-country":
      return mapCandidates().length >= 1 && state.pool.length >= 5;
    case "currency-to-country":
      return state.pool.some((c) => c.currencies.length > 0);
    case "country-to-language":
      return languageCandidates().length >= 1;
    case "country-to-region":
      return true;
    default:
      return state.pool.length >= 5;
  }
}

function enabledFormats() {
  let active = [...state.selectedTypes].filter((t) => state.availableTypes.includes(t));
  // "País → Continente" no tiene sentido con un solo continente elegido.
  if (state.selectedRegions.size === 1)
    active = active.filter((f) => f !== "country-to-region");
  return active;
}

function newQuestion() {
  if (state.pool.length < 5) {
    renderError("Selecciona al menos un continente para empezar.");
    return;
  }
  const formats = enabledFormats().filter(formatUsable);
  if (formats.length === 0) {
    renderError("No hay preguntas disponibles con esta combinación. Activa más tipos o continentes.");
    return;
  }
  const type = pick(formats);
  state.current = { type, ...FORMATS[type]() };
  state.answered = false;
  renderQuestion();
}

/* ----------------------------- render ------------------------------ */

function renderError(msg) {
  el.qbadge.hidden = true;
  el.visual.hidden = true;
  el.visual.innerHTML = "";
  el.feedback.hidden = true;
  el.options.innerHTML = "";
  el.prompt.innerHTML = `<span class="error">${msg}</span>`;
  el.nextBtn.hidden = true;
}

const SVG_NS = "http://www.w3.org/2000/svg";
let baseGeoSvg = null;

// SVG base con todos los países (se construye una vez y se clona por pregunta)
function buildBaseGeoSvg() {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "geo-map");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  for (const [code, c] of Object.entries(WM.c)) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", c.d);
    path.setAttribute("class", "geo-land");
    path.dataset.code = code;
    svg.appendChild(path);
  }
  return svg;
}

function renderMapShape(cca2) {
  if (!baseGeoSvg) baseGeoSvg = buildBaseGeoSvg();
  const svg = baseGeoSvg.cloneNode(true);

  const target = svg.querySelector(`path[data-code="${cca2}"]`);
  if (target) {
    target.classList.add("geo-target");
    svg.appendChild(target); // lo dibuja encima de los vecinos
  }

  // zoom: viewBox cuadrado centrado en el país + margen para ver el contexto
  const [minx, miny, maxx, maxy] = WM.c[cca2].bb;
  const w = maxx - minx;
  const h = maxy - miny;
  let size = Math.max(w, h) * 2.4 + 50;
  size = Math.max(160, Math.min(size, Math.max(WM.w, WM.h)));
  const cx = (minx + maxx) / 2;
  const cy = (miny + maxy) / 2;
  svg.setAttribute("viewBox", `${cx - size / 2} ${cy - size / 2} ${size} ${size}`);

  const wrap = document.createElement("div");
  wrap.className = "map-wrap";
  wrap.appendChild(svg);
  return wrap;
}

function renderQuestion() {
  const q = state.current;
  const meta = QUESTION_TYPES[q.type];

  el.qbadge.hidden = false;
  el.qbadge.style.setProperty("--badge", meta.color);
  el.qbadge.innerHTML = `<span class="badge-icon">${meta.icon}</span> ${meta.label}`;

  el.prompt.innerHTML = q.prompt;

  // área visual (bandera / silueta / monumento / mapa)
  el.visual.innerHTML = "";
  el.visual.className = "visual";
  if (q.image) {
    el.visual.hidden = false;
    el.visual.classList.add(`visual-${q.image.kind}`);
    const img = document.createElement("img");
    img.src = q.image.src;
    img.alt = q.image.alt;
    el.visual.appendChild(img);
  } else if (q.mapShape) {
    el.visual.hidden = false;
    el.visual.classList.add("visual-map");
    el.visual.appendChild(renderMapShape(q.mapShape));
  } else {
    el.visual.hidden = true;
  }

  // opciones (texto o banderas)
  el.options.innerHTML = "";
  el.options.classList.toggle("flag-grid", q.optionStyle === "flag");
  q.options.forEach((opt, i) => {
    const value = typeof opt === "string" ? opt : opt.value;
    const btn = document.createElement("button");
    btn.className = "option";
    btn.type = "button";
    btn.dataset.value = value;
    if (q.optionStyle === "flag") {
      btn.classList.add("flag-option");
      btn.setAttribute("aria-label", value);
      btn.innerHTML =
        `<span class="key">${i + 1}</span>` +
        `<img src="${FLAG_URL(opt.flag)}" alt="" loading="eager" />` +
        `<span class="opt-mark" aria-hidden="true"></span>` +
        `<span class="opt-label"></span>`;
    } else {
      btn.innerHTML =
        `<span class="key">${i + 1}</span>` +
        `<span class="opt-text">${value}</span>` +
        `<span class="opt-hint" aria-hidden="true"></span>` +
        `<span class="opt-mark" aria-hidden="true"></span>`;
    }
    btn.addEventListener("click", () => answer(value));
    el.options.appendChild(btn);
  });

  el.feedback.hidden = true;
  el.feedback.className = "feedback";
  el.nextBtn.hidden = true;

  el.card.classList.remove("fade-in");
  void el.card.offsetWidth;
  el.card.classList.add("fade-in");
}

function answer(value) {
  if (state.answered) return;
  state.answered = true;
  const q = state.current;
  const correct = value === q.correct;

  state.total += 1;
  if (correct) {
    state.score += 1;
    state.streak += 1;
  } else {
    state.streak = 0;
  }
  updateStats();

  const isFlag = q.optionStyle === "flag";
  el.options.querySelectorAll(".option").forEach((btn) => {
    btn.disabled = true;
    const v = btn.dataset.value;
    const mark = btn.querySelector(".opt-mark");
    if (v === q.correct) {
      btn.classList.add("correct");
      mark.textContent = "✓";
    } else if (v === value) {
      btn.classList.add("wrong");
      mark.textContent = "✗";
    } else {
      btn.classList.add("dimmed");
    }
    // En las banderas, revelar a qué país pertenece cada alternativa.
    if (isFlag) {
      const label = btn.querySelector(".opt-label");
      if (label) label.textContent = v;
    }
    // En las demás, revelar el dato relacionado con la pregunta.
    const hintEl = btn.querySelector(".opt-hint");
    if (hintEl) {
      switch (OPTION_HINT[q.type]) {
        case "capital":
          hintEl.textContent = state.capitalByCountry[v] || "";
          break;
        case "country":
          hintEl.textContent = state.countryByCapital[v] || "";
          break;
        case "currency":
          hintEl.textContent = state.currencyByName[v] || "";
          break;
        case "flag": {
          const cca2 = state.cca2ByName[v];
          if (cca2) hintEl.innerHTML = `<img class="hint-flag" src="${FLAG_URL(cca2)}" alt="" />`;
          break;
        }
      }
    }
  });

  el.feedback.hidden = false;
  el.feedback.classList.add(correct ? "ok" : "bad");
  // En banderas el país correcto ya está en el enunciado y etiquetado bajo la
  // bandera, así que no se repite en el feedback.
  let msg = correct
    ? "¡Correcto! 🎉"
    : isFlag
    ? "Incorrecto"
    : `Incorrecto — la respuesta era ${q.correct}`;
  if (q.note) msg += ` · ${q.note}`;
  el.feedback.textContent = msg;

  el.nextBtn.hidden = false;
  el.nextBtn.focus();
}

function updateStats() {
  el.score.textContent = state.score;
  el.streak.textContent = state.streak;
  el.accuracy.textContent =
    state.total === 0 ? "—" : `${Math.round((state.score / state.total) * 100)}%`;
}

/* ------------------------------ setup ------------------------------ */

function applyRegionFilter() {
  state.pool = state.all.filter((c) => state.selectedRegions.has(c.region));
}

const TYPE_AVAILABLE = {
  "capital-to-country": () => true,
  "country-to-capital": () => true,
  "flag-to-country": () => true,
  "country-to-flag": () => true,
  "country-to-region": () => true,
  "currency-to-country": () => state.all.some((c) => c.currencies.length > 0),
  "country-to-language": () =>
    state.all.some((c) => (c.languages || []).some((l) => !LANG_BLACKLIST.has(l.code))),
  "silhouette-to-country": () => Object.keys(ASSETS.silhouettes).length > 0,
  "map-location-to-country": () => Object.keys(WM.c).length > 0,
  "landmark-to-country": () => Object.keys(ASSETS.landmarks).length > 0,
};

function bindEvents() {
  el.nextBtn.addEventListener("click", newQuestion);
  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, select, textarea")) return;
    if (e.key >= "1" && e.key <= "5" && !state.answered) {
      const btn = el.options.querySelectorAll(".option")[Number(e.key) - 1];
      if (btn) btn.click();
    } else if ((e.key === "Enter" || e.key === " ") && state.answered) {
      e.preventDefault();
      newQuestion();
    }
  });
}

function init() {
  if (!Array.isArray(window.COUNTRIES) || window.COUNTRIES.length === 0) {
    renderError("No se cargaron los datos (data.js). Ejecuta: python build_data.py");
    return;
  }
  state.all = window.COUNTRIES;
  state.capitalByCountry = Object.fromEntries(state.all.map((c) => [c.name, c.capital]));
  state.countryByCapital = Object.fromEntries(state.all.map((c) => [c.capital, c.name]));
  state.cca2ByName = Object.fromEntries(state.all.map((c) => [c.name, c.cca2]));
  state.currencyByName = Object.fromEntries(
    state.all.map((c) => [c.name, c.currencies[0] ? c.currencies[0].name : ""])
  );
  state.langNames = [
    ...new Set(state.all.flatMap((c) => majorLangs(c).map((l) => l.name))),
  ];
  state.availableTypes = Object.keys(QUESTION_TYPES).filter((t) => TYPE_AVAILABLE[t]());
  state.selectedTypes = new Set(state.availableTypes);
  applyRegionFilter();
  buildControls();
  bindEvents();
  newQuestion();
}

init();
