/* ==========================================================================
   Mis Aventuras RD — lógica de la aplicación
   Estado, almacenamiento local (IndexedDB + respaldo), destinos, fotos,
   presupuesto, estadísticas, importación/exportación y interfaz.
   ========================================================================== */
(function () {
  "use strict";

  /* ------------------------------------------------------------------------
     Constantes
     ------------------------------------------------------------------------ */
  var APP_ID = "mis-aventuras-rd";
  var APP_VERSION = "2.1.0";
  var BACKUP_FORMAT = 3;
  var MAX_IMPORT_BYTES = 1500 * 1024 * 1024;
  var DB_NAME = "mis-aventuras-rd";
  var DB_VERSION = 1;
  var DB_STORE = "kv";
  var DB_KEY = "state";
  var LEGACY_DB = "aventuras";
  var LS_STATE = "mis-aventuras-rd-state-v2";
  var LS_THEME = "mar-theme";

  var PROVINCES = [
    "Azua", "Bahoruco", "Barahona", "Dajabón", "Distrito Nacional", "Duarte",
    "El Seibo", "Elías Piña", "Espaillat", "Hato Mayor", "Hermanas Mirabal",
    "Independencia", "La Altagracia", "La Romana", "La Vega",
    "María Trinidad Sánchez", "Monseñor Nouel", "Monte Cristi", "Monte Plata",
    "Pedernales", "Peravia", "Puerto Plata", "Samaná", "San Cristóbal",
    "San José de Ocoa", "San Juan", "San Pedro de Macorís", "Sánchez Ramírez",
    "Santiago", "Santiago Rodríguez", "Santo Domingo", "Valverde"
  ];

  var CATS = {
    transporte: "Transporte",
    combustible: "Combustible",
    comida: "Comida y bebidas",
    hospedaje: "Hospedaje",
    entradas: "Entradas y actividades",
    compras: "Compras",
    otros: "Otros gastos"
  };

  var FILTERS = [
    { id: "all", label: "Todos" },
    { id: "v", label: "Visitados" },
    { id: "p", label: "Por conocer" }
  ];

  var DEMO = [
    {
      id: "demo-bahia",
      name: "Bahía de las Águilas",
      prov: "Pedernales",
      loc: "Cabo Rojo",
      lat: 17.78,
      lng: -71.65,
      visited: false,
      prio: "alta",
      desc: "Una de las playas más vírgenes del Caribe, con agua transparente y arena blanca.",
      reason: "Conocer el sur profundo y quedarme unos días desconectado.",
      notes: "Llevar efectivo, protector solar y agua. Revisar el estado de la carretera.",
      bud: { transporte: [7000, 0], comida: [2500, 0], hospedaje: [4500, 0] }
    },
    {
      id: "demo-pico",
      name: "Pico Duarte",
      prov: "San Juan",
      loc: "Valle de Bohechío",
      lat: 19.0231,
      lng: -70.9987,
      visited: true,
      start: "2025-01-18",
      end: "2025-01-19",
      trip: "Ruta al techo del Caribe",
      purpose: "Subir a la cumbre más alta de las Antillas.",
      desc: "Dos días de caminata entre pinos, frío de montaña y amanecer sobre las nubes.",
      notes: "La mochila pesó demasiado. Para la próxima, menos ropa y más capas térmicas.",
      bud: { transporte: [4500, 5200], comida: [2000, 2400], hospedaje: [3500, 3500], entradas: [1500, 1200] }
    },
    {
      id: "demo-limon",
      name: "Salto El Limón",
      prov: "Samaná",
      loc: "El Limón",
      lat: 19.2987,
      lng: -69.4325,
      visited: true,
      start: "2024-07-12",
      trip: "Escapada a Samaná",
      purpose: "Bañarme en la cascada y recorrer el sendero a caballo.",
      desc: "Cascada de unos 50 metros en medio de la selva, con pozas de agua fresca.",
      notes: "Ir temprano para evitar el calor y la gente. El sendero es resbaladizo.",
      bud: { transporte: [3000, 2800], comida: [1200, 1500], entradas: [1000, 900] }
    },
    {
      id: "demo-colonial",
      name: "Zona Colonial",
      prov: "Distrito Nacional",
      loc: "Ciudad Colonial",
      lat: 18.4733,
      lng: -69.8830,
      visited: true,
      start: "2024-03-09",
      trip: "Fin de semana en Santo Domingo",
      purpose: "Recorrer la primera ciudad europea de América.",
      desc: "Calles empedradas, fortalezas, museos y cafés alrededor del Parque Colón.",
      notes: "El atardecer desde la Plaza España es imperdible.",
      bud: { transporte: [1000, 1200], comida: [2500, 3100], entradas: [800, 600], compras: [1500, 2100] }
    }
  ];

  var MONEY_FORMAT = new Intl.NumberFormat("es-DO", {
    style: "currency",
    currency: "DOP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  var NUMBER_FORMAT = new Intl.NumberFormat("es-DO");

  var mediaDark = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  /* ------------------------------------------------------------------------
     Estado de la aplicación
     ------------------------------------------------------------------------ */
  var S = { items: [], settings: { theme: "auto" }, updatedAt: 0 };

  var ui = {
    filter: "all",
    query: "",
    sel: null,
    placing: false,
    placementScroll: 0,
    D: null,
    dirty: false,
    overlay: null,
    photoContext: null,
    photoItemId: null,
    uploading: false,
    pvList: [],
    pvIndex: 0,
    pvSource: null,
    dialogConfirm: null,
    restoreActions: null,
    busy: false,
    gearReturnFocus: null,
    markerSignature: "",
    persistRequested: false,
    loaded: false
  };

  var els = {};
  var map = null;
  var markerEls = new Map();
  var clusterEls = new Map();
  var clusterGroups = new Map();
  var saveChain = Promise.resolve();
  var toastTimer = null;
  var dbPromise = null;
  var resizeObserver = null;

  /* ------------------------------------------------------------------------
     Utilidades
     ------------------------------------------------------------------------ */
  function $(id) {
    return document.getElementById(id);
  }

  function icon(name, extra) {
    return '<svg class="ic' + (extra ? " " + extra : "") + '" aria-hidden="true"><use href="#i-' + name + '"></use></svg>';
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }

  function escAttr(value) {
    return esc(value);
  }

  function normalizeText(value) {
    return String(value == null ? "" : value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function clamp(value, min, max) {
    return value < min ? min : value > max ? max : value;
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function validId(value) {
    var id = String(value == null ? "" : value);
    return /^[a-zA-Z0-9_-]{1,90}$/.test(id) ? id : "";
  }

  function number(value) {
    var n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function coordNumber(value) {
    var n = Number(String(value == null ? "" : value).trim().replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }

  function money(value) {
    return MONEY_FORMAT.format(number(value));
  }

  function moneyShort(value) {
    return "RD$ " + NUMBER_FORMAT.format(Math.round(number(value)));
  }

  function plural(count, singular, pluralForm) {
    return NUMBER_FORMAT.format(count) + " " + (count === 1 ? singular : (pluralForm || singular + "s"));
  }

  function capitalize(value) {
    var text = String(value == null ? "" : value);
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
  }

  function parseDateOnly(value) {
    if (!value) return null;
    var parts = String(value).split("-");
    if (parts.length !== 3) return null;
    var date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 12, 0, 0);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function fmtDate(value) {
    var date = parseDateOnly(value);
    if (!date) return "";
    return date.toLocaleDateString("es-DO", { day: "numeric", month: "short", year: "numeric" });
  }

  function dateRange(item) {
    if (!item.start && !item.end) return "";
    if (item.start && item.end && item.start !== item.end) return fmtDate(item.start) + " – " + fmtDate(item.end);
    return fmtDate(item.start || item.end);
  }

  function tripDays(item) {
    var start = parseDateOnly(item.start);
    if (!start) return null;
    var end = parseDateOnly(item.end) || start;
    return Math.max(1, Math.round((end - start) / 86400000) + 1);
  }

  function formatBytes(bytes) {
    var value = number(bytes);
    if (!value) return "0 B";
    var units = ["B", "KB", "MB", "GB", "TB"];
    var index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
    var amount = value / Math.pow(1024, index);
    return amount.toFixed(index === 0 ? 0 : amount >= 10 ? 1 : 1) + " " + units[index];
  }

  function safeImageUrl(value) {
    var url = String(value == null ? "" : value).trim();
    if (!url) return "";
    if (/^data:image\/(?:png|jpe?g|webp|gif|avif);base64,/i.test(url)) return url;
    if (/^https?:\/\/[^\s"'<>]+$/i.test(url)) return url;
    return "";
  }

  function cssUrl(value) {
    var url = safeImageUrl(value);
    if (!url) return "none";
    return 'url("' + url.replace(/\\/g, "\\\\").replace(/"/g, "%22").replace(/[\r\n]/g, "") + '")';
  }

  function photoCover(item) {
    return item && item.photos && item.photos.length ? item.photos[0] : null;
  }

  function photoThumb(item) {
    var photo = photoCover(item);
    return photo ? (photo.thumb || photo.full) : "";
  }

  function photoFull(item) {
    var photo = photoCover(item);
    return photo ? (photo.full || photo.thumb) : "";
  }

  function budgetTotals(item) {
    var estimated = 0;
    var actual = 0;
    if (item && item.bud) {
      Object.keys(item.bud).forEach(function (key) {
        var pair = item.bud[key] || [0, 0];
        estimated += number(pair[0]);
        actual += number(pair[1]);
      });
    }
    return { estimated: estimated, actual: actual, difference: estimated - actual };
  }

  function cleanBudget(raw) {
    var budget = {};
    if (!raw || typeof raw !== "object") return budget;
    Object.keys(CATS).forEach(function (key) {
      var value = raw[key];
      if (Array.isArray(value)) {
        var estimated = Math.max(0, number(value[0]));
        var actual = Math.max(0, number(value[1]));
        if (estimated || actual) budget[key] = [estimated, actual];
      } else if (typeof value === "number" && value > 0) {
        budget[key] = [value, 0];
      }
    });
    return budget;
  }

  function normalizePhoto(value) {
    if (typeof value === "string") {
      var onlyFull = safeImageUrl(value);
      return onlyFull ? { id: uid(), full: onlyFull, thumb: onlyFull, w: 0, h: 0 } : null;
    }
    if (!value || typeof value !== "object") return null;
    var full = safeImageUrl(value.full || value.src || value.url || value.data);
    if (!full) return null;
    var thumb = safeImageUrl(value.thumb) || full;
    return {
      id: validId(value.id) || uid(),
      full: full,
      thumb: thumb,
      w: Math.max(0, number(value.w)),
      h: Math.max(0, number(value.h)),
      added: number(value.added) || Date.now()
    };
  }

  function normalizeItem(raw) {
    if (!raw || typeof raw !== "object") return null;
    var item = Object.assign({}, raw);
    item.id = validId(raw.id) || uid();
    item.name = String(raw.name == null ? "" : raw.name).trim().slice(0, 240);
    item.prov = String(raw.prov == null ? "" : raw.prov).trim().slice(0, 120);
    item.loc = String(raw.loc == null ? "" : raw.loc).trim().slice(0, 160);
    item.trip = String(raw.trip == null ? "" : raw.trip).trim().slice(0, 240);
    item.desc = String(raw.desc == null ? "" : raw.desc).trim().slice(0, 5000);
    item.purpose = String(raw.purpose == null ? "" : raw.purpose).trim().slice(0, 1000);
    item.reason = String(raw.reason == null ? "" : raw.reason).trim().slice(0, 1000);
    item.prio = ["baja", "media", "alta"].indexOf(raw.prio) >= 0 ? raw.prio : "";
    item.start = /^\d{4}-\d{2}-\d{2}$/.test(String(raw.start || "")) ? String(raw.start) : "";
    item.end = /^\d{4}-\d{2}-\d{2}$/.test(String(raw.end || "")) ? String(raw.end) : "";
    item.notes = String(raw.notes == null ? "" : raw.notes).trim().slice(0, 8000);
    item.url = String(raw.url == null ? "" : raw.url).trim().slice(0, 2000);
    item.visited = !!raw.visited;
    item.demo = !!raw.demo;
    var rawLat = raw.lat == null || raw.lat === "" ? null : coordNumber(raw.lat);
    var rawLng = raw.lng == null || raw.lng === "" ? null : coordNumber(raw.lng);
    item.lat = rawLat != null && Number.isFinite(rawLat) && Math.abs(rawLat) <= 90 ? rawLat : null;
    item.lng = rawLng != null && Number.isFinite(rawLng) && Math.abs(rawLng) <= 180 ? rawLng : null;
    if (item.lat == null || item.lng == null) {
      item.lat = null;
      item.lng = null;
    }
    item.photos = (Array.isArray(raw.photos) ? raw.photos : []).map(normalizePhoto).filter(Boolean);
    item.bud = cleanBudget(raw.bud);
    item.created = number(raw.created) || Date.now();
    item.updated = number(raw.updated) || item.created;
    return item.name ? item : null;
  }

  function normalizeState(raw) {
    var items = [];
    var settings = { theme: "auto" };
    if (Array.isArray(raw)) {
      items = raw;
    } else if (raw && typeof raw === "object") {
      items = Array.isArray(raw.items) ? raw.items : [];
      if (raw.settings && ["auto", "light", "dark"].indexOf(raw.settings.theme) >= 0) {
        settings.theme = raw.settings.theme;
      }
    }
    return {
      items: items.map(normalizeItem).filter(Boolean),
      settings: settings,
      updatedAt: raw && number(raw.updatedAt) || Date.now()
    };
  }

  /* ------------------------------------------------------------------------
     Almacenamiento
     ------------------------------------------------------------------------ */
  function openDatabase(name, version, upgrade) {
    return new Promise(function (resolve, reject) {
      var request;
      try {
        request = indexedDB.open(name, version);
      } catch (error) {
        reject(error);
        return;
      }
      request.onupgradeneeded = function (event) {
        if (typeof upgrade === "function") upgrade(request.result, event);
      };
      request.onsuccess = function () {
        resolve(request.result);
      };
      request.onerror = function () {
        reject(request.error || new Error("No se pudo abrir IndexedDB"));
      };
      request.onblocked = function () {
        reject(new Error("IndexedDB bloqueado"));
      };
    });
  }

  function getDatabase() {
    if (!dbPromise) {
      dbPromise = openDatabase(DB_NAME, DB_VERSION, function (db) {
        if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
      });
    }
    return dbPromise;
  }

  function readDatabase(db, store, key) {
    return new Promise(function (resolve, reject) {
      try {
        var transaction = db.transaction(store, "readonly");
        var request = transaction.objectStore(store).get(key);
        request.onsuccess = function () { resolve(request.result); };
        request.onerror = function () { reject(request.error || transaction.error); };
      } catch (error) {
        reject(error);
      }
    });
  }

  function writeDatabase(db, store, key, value) {
    return new Promise(function (resolve, reject) {
      try {
        var transaction = db.transaction(store, "readwrite");
        transaction.objectStore(store).put(value, key);
        transaction.oncomplete = function () { resolve(true); };
        transaction.onerror = function () { reject(transaction.error || new Error("Error de escritura")); };
        transaction.onabort = function () { reject(transaction.error || new Error("Escritura abortada")); };
      } catch (error) {
        reject(error);
      }
    });
  }

  async function readLegacyState() {
    if (!window.indexedDB) return null;
    try {
      if (indexedDB.databases) {
        var databases = await indexedDB.databases();
        var exists = databases.some(function (db) { return db.name === LEGACY_DB; });
        if (!exists) return null;
      }
      var legacy = await openDatabase(LEGACY_DB, 1);
      if (!legacy.objectStoreNames.contains("kv")) {
        legacy.close();
        return null;
      }
      var state = await readDatabase(legacy, "kv", "state");
      legacy.close();
      return state || null;
    } catch (error) {
      return null;
    }
  }

  async function loadState() {
    var raw = null;
    var source = "";
    try {
      var db = await getDatabase();
      raw = await readDatabase(db, DB_STORE, DB_KEY);
      if (raw) source = "idb";
    } catch (error) {
      raw = null;
    }

    var localRaw = null;
    try {
      localRaw = JSON.parse(localStorage.getItem(LS_STATE) || "null");
    } catch (error) {
      localRaw = null;
    }

    // Si el último guardado cayó al respaldo de localStorage, ese estado es
    // más nuevo que lo que quedó en IndexedDB. No lo perdamos al recargar.
    if (raw && localRaw && number(localRaw.updatedAt) > number(raw.updatedAt)) {
      raw = localRaw;
      source = "local";
    }
    if (!raw && localRaw) {
      raw = localRaw;
      source = "local";
    }
    if (!raw) {
      raw = await readLegacyState();
      if (raw) source = "legacy";
    }
    return { state: normalizeState(raw), source: source };
  }

  async function doPersist() {
    S.updatedAt = Date.now();
    try {
      var db = await getDatabase();
      await writeDatabase(db, DB_STORE, DB_KEY, S);
      try {
        localStorage.removeItem(LS_STATE);
      } catch (error) { /* sin permisos */ }
      if (!ui.persistRequested && navigator.storage && navigator.storage.persist) {
        ui.persistRequested = true;
        navigator.storage.persist().catch(function () {});
      }
      return true;
    } catch (error) {
      try {
        localStorage.setItem(LS_STATE, JSON.stringify(S));
        return true;
      } catch (storageError) {
        toast("No se pudo guardar. Libera espacio o exporta una copia de seguridad.");
        return false;
      }
    }
  }

  function persist() {
    saveChain = saveChain.then(doPersist, doPersist);
    return saveChain;
  }

  /* ------------------------------------------------------------------------
     Tema
     ------------------------------------------------------------------------ */
  function currentTheme() {
    return S.settings && S.settings.theme ? S.settings.theme : "auto";
  }

  function effectiveTheme() {
    var theme = currentTheme();
    if (theme === "auto") {
      return mediaDark && mediaDark.matches ? "dark" : "light";
    }
    return theme;
  }

  function applyTheme() {
    var theme = currentTheme();
    if (theme === "auto") {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.dataset.theme = theme;
    }
    try {
      if (theme === "auto") localStorage.removeItem(LS_THEME);
      else localStorage.setItem(LS_THEME, theme);
    } catch (error) { /* sin permisos */ }

    var use = document.querySelector("#theme-icon use");
    if (use) use.setAttribute("href", effectiveTheme() === "dark" ? "#i-sun" : "#i-moon");

    var meta = $("meta-theme");
    if (meta) meta.setAttribute("content", effectiveTheme() === "dark" ? "#111a16" : "#f7f3ea");

    document.querySelectorAll("[data-theme-value]").forEach(function (button) {
      button.classList.toggle("is-active", button.dataset.themeValue === theme);
    });
  }

  function setTheme(theme) {
    if (["auto", "light", "dark"].indexOf(theme) < 0) return;
    S.settings.theme = theme;
    applyTheme();
    persist();
  }

  function toggleTheme() {
    setTheme(effectiveTheme() === "dark" ? "light" : "dark");
  }

  /* ------------------------------------------------------------------------
     Arranque
     ------------------------------------------------------------------------ */
  function init() {
    els.app = $("app");
    els.map = $("map");
    els.topbar = $("topbar");
    els.markers = $("markers");
    els.search = $("search");
    els.clearSearch = document.querySelector(".clear-search");
    els.chips = $("chips");
    els.count = $("count");
    els.hint = $("hint");
    els.preview = $("preview");
    els.overlay = $("overlay");
    els.lightbox = $("lightbox");
    els.dialog = $("dialog");
    els.gearMenu = $("gear-menu");
    els.gearBtn = $("gear-btn");
    els.busy = $("busy");
    els.busyTitle = $("busy-title");
    els.busyDetail = $("busy-detail");
    els.busyTrack = $("busy-track");
    els.busyBar = $("busy-bar");
    els.toast = $("toast");
    els.addBtn = $("add-btn");
    els.placementBar = $("placement-bar");
    els.photoInput = $("photo-input");
    els.cameraInput = $("camera-input");
    els.importInput = $("import-input");

    bindEvents();
    applyTheme();
    renderChips();
    renderAll();
    initMap();

    loadState().then(function (result) {
      S = result.state;
      ui.loaded = true;
      applyTheme();
      renderAll();
      if (result.source === "legacy" || result.source === "local") {
        persist();
        if (result.state.items.length) toast("Datos de la versión anterior importados.");
      }
    }).catch(function () {
      ui.loaded = true;
      renderAll();
      toast("No se pudieron cargar los datos guardados.");
    });
  }

  function initMap() {
    if (!window.RD_GEO || !window.MapView) {
      toast("No se pudo cargar el mapa vectorial.");
      return;
    }
    map = new MapView({
      container: els.map,
      svg: $("map-svg"),
      world: $("world"),
      land: $("land"),
      coastGlow: $("coast-glow"),
      cityLayer: $("city-layer"),
      countryLabel: $("country-label"),
      seaCaribbean: $("sea-caribbean"),
      seaAtlantic: $("sea-atlantic"),
      geo: window.RD_GEO,
      getInsets: function () {
        var top = els.topbar ? els.topbar.getBoundingClientRect().bottom + 12 : 170;
        return { top: top, right: 16, left: 16, bottom: 104 };
      },
      onView: function () {
        updateMarkerPositions();
      },
      onClick: function (point) {
        handleMapClick(point);
      }
    });
    map.start();

    if (typeof ResizeObserver === "function") {
      resizeObserver = new ResizeObserver(function () {
        if (map) map.resize(false);
      });
      resizeObserver.observe(els.topbar);
    }
  }

  /* ------------------------------------------------------------------------
     Eventos globales
     ------------------------------------------------------------------------ */
  function bindEvents() {
    document.addEventListener("click", onDocumentClick);
    document.addEventListener("keydown", onKeyDown);
    els.search.addEventListener("input", function () {
      ui.query = els.search.value;
      updateSearchClear();
      renderAll();
    });
    els.overlay.addEventListener("scroll", function () {
      var head = els.overlay.querySelector(".overlay-head");
      if (head) head.classList.toggle("is-scrolled", els.overlay.scrollTop > 4);
    }, { passive: true });
    els.overlay.addEventListener("input", onFormInput);
    els.overlay.addEventListener("change", onFormInput);

    els.markers.addEventListener("click", function (event) {
      var card = event.target.closest(".marker-card");
      if (card) {
        var id = card.parentElement && card.parentElement.dataset.id;
        if (id) selectItem(id);
        return;
      }
      var cluster = event.target.closest(".cluster-dot");
      if (cluster) {
        var key = cluster.parentElement && cluster.parentElement.dataset.key;
        if (key) handleClusterClick(key);
      }
    });

    els.photoInput.addEventListener("change", function () {
      var files = Array.prototype.slice.call(this.files || []);
      this.value = "";
      if (files.length) handlePhotoFiles(files);
    });
    els.cameraInput.addEventListener("change", function () {
      var files = Array.prototype.slice.call(this.files || []);
      this.value = "";
      if (files.length) handlePhotoFiles(files);
    });
    els.importInput.addEventListener("change", function () {
      var file = this.files && this.files[0];
      this.value = "";
      if (file) handleImportFile(file);
    });

    els.gearMenu.addEventListener("click", function (event) {
      if (event.target === els.gearMenu) closeGearMenu();
    });

    els.dialog.addEventListener("click", function (event) {
      if (event.target === els.dialog) closeDialog();
    });
    els.lightbox.addEventListener("click", function (event) {
      if (event.target === els.lightbox || event.target.classList.contains("lb-stage")) closeLightbox();
    });
    bindLightboxSwipe();

    els.overlay.addEventListener("dragenter", onDragOver);
    els.overlay.addEventListener("dragover", onDragOver);
    els.overlay.addEventListener("dragleave", onDragLeave);
    els.overlay.addEventListener("drop", onDrop);
    document.addEventListener("paste", onPaste);

    if (mediaDark) {
      var onScheme = function () {
        if (currentTheme() === "auto") applyTheme();
      };
      if (mediaDark.addEventListener) mediaDark.addEventListener("change", onScheme);
      else if (mediaDark.addListener) mediaDark.addListener(onScheme);
    }

    window.addEventListener("beforeunload", function (event) {
      if (ui.overlay === "form" && ui.dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    });
  }

  function onDocumentClick(event) {
    var actionEl = event.target.closest("[data-action]");
    if (!actionEl || actionEl.disabled) return;
    var action = actionEl.dataset.action;
    if (!action) return;

    switch (action) {
      case "add":
        openForm(null);
        break;
      case "stats":
        closeGearMenu();
        renderStats();
        break;
      case "open-gear":
        openGearMenu();
        break;
      case "close-gear":
        closeGearMenu();
        break;
      case "backup-share":
        shareBackup();
        break;
      case "backup-export":
        exportBackup();
        break;
      case "backup-import":
        openImportPicker();
        break;
      case "open-backup":
        closeOverlay(true);
        openGearMenu();
        break;
      case "restore-merge":
        runRestore("merge");
        break;
      case "restore-replace":
        runRestore("replace");
        break;
      case "toggle-theme":
        toggleTheme();
        break;
      case "set-theme":
        setTheme(actionEl.dataset.themeValue);
        break;
      case "clear-search":
        els.search.value = "";
        ui.query = "";
        updateSearchClear();
        renderAll();
        els.search.focus();
        break;
      case "filter":
        ui.filter = actionEl.dataset.filter;
        renderAll();
        break;
      case "reset-filters":
        ui.filter = "all";
        ui.query = "";
        els.search.value = "";
        updateSearchClear();
        renderAll();
        break;
      case "zoom-in":
        if (map) map.zoomBy(1.5, true);
        break;
      case "zoom-out":
        if (map) map.zoomBy(0.66, true);
        break;
      case "home":
        if (map) map.home(true);
        clearSelection();
        break;
      case "demo":
        loadDemo();
        break;
      case "close-overlay":
      case "cancel-form":
        requestCloseOverlay();
        break;
      case "detail":
        if (!els.dialog.hidden) closeDialog();
        openDetail(actionEl.dataset.id);
        break;
      case "edit":
        openForm(actionEl.dataset.id);
        break;
      case "delete":
        deleteItem(actionEl.dataset.id);
        break;
      case "mark-visited":
        markVisited(actionEl.dataset.id);
        break;
      case "share":
        shareItem(actionEl.dataset.id);
        break;
      case "google-maps":
        openGoogleMaps(actionEl.dataset.id);
        break;
      case "view-map":
        viewOnMap(actionEl.dataset.id);
        break;
      case "copy-coords":
        copyCoords(actionEl.dataset.id);
        break;
      case "place-location":
        enterPlacement();
        break;
      case "cancel-placement":
        cancelPlacement();
        break;
      case "clear-location":
        if (ui.D) {
          ui.D.lat = null;
          ui.D.lng = null;
          ui.dirty = true;
          renderForm();
        }
        break;
      case "detect-url":
        detectUrl();
        break;
      case "use-geolocation":
        useGeolocation();
        break;
      case "set-visited":
        setVisited(actionEl.dataset.visited === "1");
        break;
      case "add-photos":
        openPhotoPicker(false);
        break;
      case "take-photo":
        openPhotoPicker(true);
        break;
      case "lightbox":
        openLightbox(Number(actionEl.dataset.index) || 0);
        break;
      case "lightbox-close":
        closeLightbox();
        break;
      case "lightbox-prev":
        lightboxStep(-1);
        break;
      case "lightbox-next":
        lightboxStep(1);
        break;
      case "set-cover":
        setCover(Number(actionEl.dataset.index));
        break;
      case "download-photo":
        downloadPhoto();
        break;
      case "delete-photo":
        deletePhoto(Number(actionEl.dataset.index));
        break;
      case "export":
        exportBackup();
        break;
      case "import":
        openImportPicker();
        break;
      case "persist-storage":
        requestPersistentStorage();
        break;
      case "remove-demo":
        removeDemo();
        break;
      case "clear-all":
        clearAll();
        break;
      case "save-item":
        saveItem();
        break;
      case "clear-selection":
        clearSelection();
        break;
      case "dialog-cancel":
        closeDialog();
        break;
      case "dialog-confirm":
        var confirm = ui.dialogConfirm;
        closeDialog();
        if (typeof confirm === "function") confirm();
        break;
      default:
        break;
    }
  }

  function onKeyDown(event) {
    if (ui.busy) return;
    if (event.key === "Escape") {
      if (!els.gearMenu.hidden) {
        closeGearMenu();
        event.preventDefault();
        return;
      }
      if (!els.dialog.hidden) {
        closeDialog();
        event.preventDefault();
        return;
      }
      if (!els.lightbox.hidden) {
        closeLightbox();
        event.preventDefault();
        return;
      }
      if (ui.placing) {
        cancelPlacement();
        event.preventDefault();
        return;
      }
      if (ui.overlay) {
        requestCloseOverlay();
        event.preventDefault();
        return;
      }
      if (ui.sel) {
        clearSelection();
        event.preventDefault();
      }
      return;
    }

    if (!els.lightbox.hidden) {
      if (event.key === "ArrowLeft") {
        lightboxStep(-1);
        event.preventDefault();
      } else if (event.key === "ArrowRight") {
        lightboxStep(1);
        event.preventDefault();
      }
    }
  }

  function updateSearchClear() {
    if (els.clearSearch) els.clearSearch.hidden = !els.search.value;
  }

  /* ------------------------------------------------------------------------
     Render general
     ------------------------------------------------------------------------ */
  function renderAll() {
    if (ui.sel && !getItem(ui.sel)) ui.sel = null;
    if (!ui.overlay && ui.sel && !filteredItems().some(function (item) { return item.id === ui.sel; })) {
      ui.sel = null;
    }
    renderChips();
    renderCount();
    renderHint();
    renderPreview();
    syncMarkerNodes();
    updateMarkerPositions();
  }

  function filteredItems() {
    var query = normalizeText(ui.query);
    return S.items.filter(function (item) {
      if (ui.filter === "v" && !item.visited) return false;
      if (ui.filter === "p" && item.visited) return false;
      if (!query) return true;
      var haystack = normalizeText([
        item.name, item.prov, item.loc, item.trip, item.desc,
        item.purpose, item.reason, item.notes, item.prio
      ].join(" "));
      return haystack.indexOf(query) >= 0;
    });
  }

  function renderChips() {
    els.chips.innerHTML = FILTERS.map(function (filter) {
      return '<button class="chip' + (ui.filter === filter.id ? " is-active" : "") +
        '" type="button" data-action="filter" data-filter="' + filter.id +
        '" aria-pressed="' + (ui.filter === filter.id) + '">' + filter.label + "</button>";
    }).join("");
  }

  function renderCount() {
    var visible = filteredItems().length;
    if (!S.items.length) {
      els.count.textContent = "";
      return;
    }
    els.count.textContent = visible === S.items.length
      ? plural(S.items.length, "destino")
      : NUMBER_FORMAT.format(visible) + " de " + NUMBER_FORMAT.format(S.items.length);
  }

  function renderHint() {
    if (!ui.loaded || ui.sel) {
      els.hint.hidden = true;
      return;
    }
    if (!S.items.length) {
      els.hint.hidden = false;
      els.hint.innerHTML =
        '<h2>Tu próxima aventura empieza aquí</h2>' +
        '<p>Guarda los lugares que quieres conocer y los que ya visitaste. Añade fotos, fechas, notas y presupuesto.</p>' +
        '<div class="hint-actions">' +
        '<button class="btn is-primary is-small" type="button" data-action="add">' + icon("plus") + 'Añadir destino</button>' +
        '<button class="btn is-ghost is-small" type="button" data-action="demo">' + icon("compass") + 'Ver ejemplos</button>' +
        "</div>";
      return;
    }
    if (!filteredItems().length) {
      els.hint.hidden = false;
      els.hint.innerHTML =
        '<h2>Sin resultados</h2>' +
        '<p>No hay destinos que coincidan con “' + esc(ui.query) + '” y el filtro actual.</p>' +
        '<div class="hint-actions">' +
        '<button class="btn is-ghost is-small" type="button" data-action="reset-filters">Limpiar filtros</button>' +
        "</div>";
      return;
    }
    els.hint.hidden = true;
  }

  function renderPreview() {
    var item = ui.sel ? getItem(ui.sel) : null;
    if (!item) {
      els.preview.hidden = true;
      els.app.classList.remove("has-preview");
      return;
    }
    var thumb = photoThumb(item);
    var meta = [];
    if (item.prov) meta.push(item.prov);
    if (item.loc) meta.push(item.loc);
    meta.push(item.visited ? "Visitado" : "Por conocer");
    var dates = dateRange(item);
    if (dates) meta.push(dates);

    els.preview.hidden = false;
    els.app.classList.add("has-preview");
    els.preview.innerHTML =
      '<div class="preview-thumb"' + (thumb ? ' style="background-image:' + escAttr(cssUrl(thumb)) + '"' : "") + ">" +
      (thumb ? "" : icon("image")) +
      "</div>" +
      '<div class="preview-body">' +
      '<h2 class="preview-title">' + esc(item.name) + "</h2>" +
      '<p class="preview-meta">' + esc(meta.join(" · ")) + "</p>" +
      '<div class="preview-actions">' +
      '<button class="action-btn is-primary" type="button" data-action="detail" data-id="' + escAttr(item.id) + '">' +
      icon("chevron-right") + "Ver detalles</button>" +
      "</div></div>" +
      '<button class="preview-close" type="button" data-action="clear-selection" aria-label="Cerrar vista previa">' +
      icon("x") + "</button>";
  }

  function selectItem(id) {
    var item = getItem(id);
    if (!item) return;
    ui.sel = id;
    renderPreview();
    renderHint();
    updateMarkerPositions();
    if (item.lat != null && item.lng != null && map) {
      map.ensureVisible(item.lng, item.lat);
    }
  }

  function clearSelection() {
    ui.sel = null;
    renderPreview();
    renderHint();
    updateMarkerPositions();
  }

  /* ------------------------------------------------------------------------
     Marcadores y agrupación
     ------------------------------------------------------------------------ */
  function syncMarkerNodes() {
    var signature = S.items.map(function (item) {
      var cover = photoCover(item);
      return [item.id, item.updated, cover ? cover.id : "", item.name, item.lat, item.lng, item.visited ? 1 : 0].join(":");
    }).join("|");
    if (signature === ui.markerSignature) return;
    ui.markerSignature = signature;
    buildMarkerNodes();
  }

  function buildMarkerNodes() {
    els.markers.innerHTML = "";
    markerEls.clear();
    clusterEls.forEach(function (el) { el.remove(); });
    clusterEls.clear();
    clusterGroups.clear();

    S.items.forEach(function (item) {
      if (item.lat == null || item.lng == null) return;
      var thumb = photoThumb(item);
      var badgeClass = item.visited ? "is-visited" : "is-pending";
      var badgeIcon = item.visited ? "check" : "compass";
      var label = item.name + (item.prov ? ", " + item.prov : "") + ", " + (item.visited ? "visitado" : "por conocer");

      var wrapper = document.createElement("div");
      wrapper.className = "marker";
      wrapper.dataset.id = item.id;
      wrapper.innerHTML =
        '<button class="marker-card" type="button" aria-label="' + escAttr(label) + '">' +
        '<span class="mc-photo"' + (thumb ? ' style="background-image:' + escAttr(cssUrl(thumb)) + '"' : "") + ">" +
        (thumb ? "" : '<span class="mc-placeholder">' + icon("image") + "</span>") +
        '<span class="mc-badge ' + badgeClass + '">' + icon(badgeIcon) + "</span>" +
        "</span>" +
        '<span class="mc-name">' + esc(item.name) + "</span>" +
        "</button>";
      els.markers.appendChild(wrapper);
      markerEls.set(item.id, wrapper);
    });
  }

  function updateMarkerPositions() {
    if (!map || !els.markers) return;

    var visible = filteredItems().filter(function (item) {
      return item.lat != null && item.lng != null;
    });

    markerEls.forEach(function (el) {
      el.classList.add("is-hidden");
      el.classList.remove("is-selected");
    });

    var points = visible.map(function (item) {
      var screen = map.screen(item.lng, item.lat);
      return { item: item, x: screen.x, y: screen.y };
    });

    var selectedPoint = null;
    if (ui.sel) {
      selectedPoint = points.find(function (point) { return point.item.id === ui.sel; }) || null;
    }

    var rest = points.filter(function (point) {
      return !selectedPoint || point.item.id !== selectedPoint.item.id;
    }).sort(function (a, b) {
      return a.y - b.y || a.x - b.x;
    });

    var clusterWidth = 132;
    var clusterHeight = 104;
    var clusters = [];

    rest.forEach(function (point) {
      var match = null;
      for (var i = 0; i < clusters.length; i++) {
        var cluster = clusters[i];
        if (Math.abs(cluster.x - point.x) < clusterWidth && Math.abs(cluster.y - point.y) < clusterHeight) {
          match = cluster;
          break;
        }
      }
      if (!match) {
        clusters.push({ x: point.x, y: point.y, items: [point] });
      } else {
        match.items.push(point);
        match.x = (match.x * (match.items.length - 1) + point.x) / match.items.length;
        match.y = (match.y * (match.items.length - 1) + point.y) / match.items.length;
      }
    });

    var usedClusters = new Set();

    clusters.forEach(function (cluster) {
      if (cluster.items.length === 1) {
        showMarker(cluster.items[0], false);
        return;
      }
      var key = cluster.items.map(function (point) { return point.item.id; }).sort().join("|");
      usedClusters.add(key);
      var wrap = clusterEls.get(key);
      if (!wrap) {
        wrap = document.createElement("div");
        wrap.className = "cluster";
        wrap.dataset.key = key;
        wrap.innerHTML =
          '<button class="cluster-dot" type="button">' +
          '<span class="cluster-count">' + cluster.items.length + "</span>" +
          "</button>" +
          '<span class="cluster-caption">destinos</span>';
        els.markers.appendChild(wrap);
        clusterEls.set(key, wrap);
      }
      var dot = wrap.querySelector(".cluster-dot");
      var count = wrap.querySelector(".cluster-count");
      if (dot) dot.setAttribute("aria-label", cluster.items.length + " destinos en esta zona. Toca para acercar.");
      if (count) count.textContent = String(cluster.items.length);
      wrap.style.transform = "translate3d(" + cluster.x.toFixed(2) + "px," + cluster.y.toFixed(2) + "px,0)";
      clusterGroups.set(key, cluster.items.map(function (point) { return point.item; }));
    });

    clusterEls.forEach(function (el, key) {
      if (!usedClusters.has(key)) {
        el.remove();
        clusterEls.delete(key);
        clusterGroups.delete(key);
      }
    });

    if (selectedPoint) showMarker(selectedPoint, true);
  }

  function showMarker(point, selected) {
    var el = markerEls.get(point.item.id);
    if (!el) return;
    var halfCard = 62;
    var edge = 6;
    var shift = 0;
    if (point.x - halfCard < edge) shift = edge - (point.x - halfCard);
    else if (point.x + halfCard > map.width - edge) shift = (map.width - edge) - (point.x + halfCard);
    var topLimit = (map.insets ? map.insets.top : 160) + 8;
    var bottomLimit = map.height - 92;
    var flipBelow = point.y - 106 < topLimit && point.y + 106 < bottomLimit;
    el.style.setProperty("--shift", shift.toFixed(1) + "px");
    el.classList.toggle("is-below", flipBelow);
    el.classList.remove("is-hidden");
    el.classList.toggle("is-selected", !!selected);
    el.style.transform = "translate3d(" + point.x.toFixed(2) + "px," + point.y.toFixed(2) + "px,0)";
  }

  function handleClusterClick(key) {
    var items = clusterGroups.get(key);
    if (!items || !items.length) return;
    var points = items.map(function (item) {
      return map.screen(item.lng, item.lat);
    });
    var minX = Math.min.apply(null, points.map(function (p) { return p.x; }));
    var maxX = Math.max.apply(null, points.map(function (p) { return p.x; }));
    var minY = Math.min.apply(null, points.map(function (p) { return p.y; }));
    var maxY = Math.max.apply(null, points.map(function (p) { return p.y; }));
    var spread = Math.max(maxX - minX, maxY - minY);

    if (spread < 46 || map.scale >= map.maxScale * 0.86) {
      showClusterList(items);
      return;
    }

    var lon = items.reduce(function (sum, item) { return sum + item.lng; }, 0) / items.length;
    var lat = items.reduce(function (sum, item) { return sum + item.lat; }, 0) / items.length;
    map.flyTo(lon, lat, Math.min(map.maxScale, map.scale * 2.15), 420);
  }

  function showClusterList(items) {
    var rows = items.map(function (item) {
      return '<button type="button" data-action="detail" data-id="' + escAttr(item.id) + '">' +
        esc(item.name) +
        '<span class="data-sub">' + esc([item.prov, item.visited ? "Visitado" : "Por conocer"].filter(Boolean).join(" · ")) + "</span>" +
        "</button>";
    }).join("");
    openDialog(
      '<div class="dialog-card" role="dialog" aria-modal="true">' +
      "<h2>" + plural(items.length, "destino") + " aquí</h2>" +
      "<p>Están muy cerca en el mapa. Elige uno para ver sus detalles.</p>" +
      '<div class="dialog-list">' + rows + "</div>" +
      '<div class="dialog-actions"><button class="btn is-ghost" type="button" data-action="dialog-cancel">Cerrar</button></div>' +
      "</div>"
    );
  }

  /* ------------------------------------------------------------------------
     Mapa: clic y colocación
     ------------------------------------------------------------------------ */
  function handleMapClick(point) {
    if (ui.placing) {
      if (!ui.D) {
        cancelPlacement();
        return;
      }
      ui.D.lat = Number(point.lat.toFixed(5));
      ui.D.lng = Number(point.lon.toFixed(5));
      ui.dirty = true;
      exitPlacement(true);
      toast("Ubicación colocada.");
      return;
    }
    if (ui.sel) clearSelection();
  }

  function enterPlacement() {
    if (!ui.D) return;
    ui.placing = true;
    ui.placementScroll = els.overlay.scrollTop;
    els.overlay.hidden = true;
    els.placementBar.hidden = false;
    els.map.classList.add("is-placing");
    els.app.classList.add("is-placing");
    updateMapEnabled();
    setTimeout(function () {
      els.map.focus({ preventScroll: true });
    }, 30);
  }

  function exitPlacement(reopen) {
    ui.placing = false;
    els.placementBar.hidden = true;
    els.map.classList.remove("is-placing");
    els.app.classList.remove("is-placing");
    if (reopen && ui.D) {
      ui.overlay = "form";
      els.overlay.hidden = false;
      renderForm();
      els.overlay.scrollTop = ui.placementScroll || 0;
    }
    updateMapEnabled();
  }

  function cancelPlacement() {
    if (!ui.placing) return;
    exitPlacement(true);
    toast("Colocación cancelada.");
  }

  function updateMapEnabled() {
    if (!map) return;
    var blocked = !!ui.overlay ||
      !els.lightbox.hidden ||
      !els.dialog.hidden ||
      (els.gearMenu && !els.gearMenu.hidden) ||
      ui.busy;
    map.setEnabled(ui.placing || !blocked);
  }

  /* ------------------------------------------------------------------------
     Overlays
     ------------------------------------------------------------------------ */
  function openOverlay(html, type) {
    ui.overlay = type;
    els.overlay.setAttribute("aria-label",
      type === "detail" ? "Detalle del destino" : type === "form" ? "Formulario de destino" : "Estadísticas y datos");
    els.overlay.innerHTML = html;
    els.overlay.hidden = false;
    els.overlay.scrollTop = 0;
    updateMapEnabled();
    requestAnimationFrame(function () {
      var head = els.overlay.querySelector(".overlay-head");
      if (head) head.classList.toggle("is-scrolled", false);
      if (window.matchMedia && window.matchMedia("(pointer: fine)").matches) {
        var focusTarget = els.overlay.querySelector('button, input, select, textarea, [href]');
        if (focusTarget && type !== "form") focusTarget.focus({ preventScroll: true });
      }
    });
  }

  function requestCloseOverlay() {
    if (ui.overlay === "form" && ui.dirty) {
      confirmDialog({
        title: "¿Descartar cambios?",
        message: "Tienes cambios sin guardar en este destino. Si sales ahora se perderán.",
        confirmLabel: "Descartar",
        cancelLabel: "Seguir editando",
        danger: true,
        onConfirm: function () { closeOverlay(true); }
      });
      return;
    }
    closeOverlay(true);
  }

  function closeOverlay(force) {
    if (!force && ui.overlay === "form" && ui.dirty) {
      requestCloseOverlay();
      return;
    }
    ui.overlay = null;
    ui.D = null;
    ui.dirty = false;
    ui.photoContext = null;
    els.overlay.hidden = true;
    els.overlay.innerHTML = "";
    updateMapEnabled();
    renderAll();
    if (map) els.map.focus({ preventScroll: true });
  }

  function openGearMenu() {
    if (ui.busy || !els.gearMenu.hidden) return;
    ui.gearReturnFocus = document.activeElement;
    els.gearMenu.hidden = false;
    if (els.gearBtn) els.gearBtn.setAttribute("aria-expanded", "true");
    updateMapEnabled();
    requestAnimationFrame(function () {
      var first = els.gearMenu.querySelector(".gear-item");
      if (first) first.focus({ preventScroll: true });
    });
  }

  function closeGearMenu() {
    if (els.gearMenu.hidden) return;
    els.gearMenu.hidden = true;
    if (els.gearBtn) els.gearBtn.setAttribute("aria-expanded", "false");
    updateMapEnabled();
    var target = ui.gearReturnFocus;
    ui.gearReturnFocus = null;
    if (target && document.contains(target)) target.focus({ preventScroll: true });
    else if (els.gearBtn) els.gearBtn.focus({ preventScroll: true });
  }

  function showBusy(title, detail) {
    ui.busy = true;
    els.busyTitle.textContent = title || "Preparando…";
    els.busyDetail.textContent = detail || "Esto puede tardar un poco.";
    els.busyTrack.hidden = true;
    els.busyBar.style.width = "0%";
    els.busy.hidden = false;
    updateMapEnabled();
  }

  function updateBusy(detail, ratio) {
    if (!ui.busy) return;
    if (detail) els.busyDetail.textContent = detail;
    if (typeof ratio === "number" && isFinite(ratio)) {
      els.busyTrack.hidden = false;
      els.busyBar.style.width = Math.max(0, Math.min(100, Math.round(ratio * 100))) + "%";
    }
  }

  function hideBusy() {
    ui.busy = false;
    els.busy.hidden = true;
    els.busyTrack.hidden = true;
    els.busyBar.style.width = "0%";
    updateMapEnabled();
  }

  function nextPaint() {
    return new Promise(function (resolve) {
      setTimeout(resolve, 0);
    });
  }

  function openDetail(id) {
    var item = getItem(id);
    if (!item) return;
    ui.sel = id;
    renderPreview();
    renderHint();
    updateMarkerPositions();
    openOverlay(detailHTML(item), "detail");
  }

  function refreshDetail(id) {
    var item = getItem(id);
    if (!item || ui.overlay !== "detail") return;
    var scroll = els.overlay.scrollTop;
    els.overlay.innerHTML = detailHTML(item);
    els.overlay.scrollTop = scroll;
    renderAll();
  }

  /* ------------------------------------------------------------------------
     Vista de detalle
     ------------------------------------------------------------------------ */
  function detailHTML(item) {
    var cover = photoFull(item);
    var tags = [];
    tags.push('<span class="tag ' + (item.visited ? "is-visited" : "is-pending") + '">' +
      icon(item.visited ? "check" : "compass") + (item.visited ? "Visitado" : "Por conocer") + "</span>");
    if (item.demo) tags.push('<span class="tag is-demo">Demo</span>');
    if (!item.visited && item.prio) tags.push('<span class="tag">' + esc(capitalize(item.prio)) + "</span>");

    var sub = [];
    if (item.prov) sub.push(esc(item.prov));
    if (item.loc) sub.push(esc(item.loc));
    var dates = dateRange(item);
    if (dates) sub.push(esc(dates));
    var days = tripDays(item);
    if (days) sub.push(esc(days === 1 ? "1 día" : days + " días"));

    var info = [];
    info.push(infoItem("Provincia", item.prov));
    info.push(infoItem("Localidad", item.loc));
    if (item.visited) {
      info.push(infoItem("Viaje", item.trip));
      info.push(infoItem("Fechas", dateRange(item)));
      info.push(infoItem("Duración", days ? (days === 1 ? "1 día" : days + " días") : ""));
      info.push(infoItem("Motivo", item.purpose, true));
    } else {
      info.push(infoItem("Prioridad", capitalize(item.prio)));
      info.push(infoItem("Por qué quiero ir", item.reason, true));
    }

    var actions =
      '<div class="detail-actions">' +
      '<button class="action-btn is-primary" type="button" data-action="edit" data-id="' + escAttr(item.id) + '">' +
      icon("edit") + "Editar</button>" +
      (item.visited ? "" :
        '<button class="action-btn" type="button" data-action="mark-visited" data-id="' + escAttr(item.id) + '">' +
        icon("check") + "Marcar visitado</button>") +
      '<button class="action-btn" type="button" data-action="share" data-id="' + escAttr(item.id) + '">' +
      icon("share") + "Compartir</button>" +
      (item.lat != null
        ? '<button class="action-btn" type="button" data-action="view-map" data-id="' + escAttr(item.id) + '">' +
          icon("map") + "Ver en el mapa</button>"
        : "") +
      '<button class="action-btn is-danger" type="button" data-action="delete" data-id="' + escAttr(item.id) + '">' +
      icon("trash") + "Eliminar</button>" +
      "</div>";

    return '<div class="detail-hero"' + (cover ? ' style="background-image:' + escAttr(cssUrl(cover)) + '"' : "") + ">" +
      '<button class="back-btn" type="button" data-action="close-overlay" aria-label="Volver al mapa">' + icon("arrow-left") + "</button>" +
      '<div class="detail-hero-content">' +
      '<div class="detail-sub">' + tags.join("") + "</div>" +
      '<h1 class="detail-title">' + esc(item.name) + "</h1>" +
      (sub.length ? '<div class="detail-sub">' + sub.map(function (part, index) {
        return (index ? '<span class="dot-sep"></span>' : "") + "<span>" + part + "</span>";
      }).join("") + "</div>" : "") +
      "</div></div>" +
      '<div class="sheet">' +
      actions +
      (info.join("") ? '<section class="section"><div class="section-head"><h2>Información</h2></div><div class="info-grid">' + info.join("") + "</div></section>" : "") +
      sectionHTML("Descripción", item.desc) +
      '<section class="section"><div class="section-head"><h2>Galería</h2><span class="section-note">' +
      (item.photos.length ? plural(item.photos.length, "foto") : "Sin fotos") + "</span></div>" +
      photoGridHTML(item, true) + "</section>" +
      budgetDetailHTML(item) +
      locationDetailHTML(item) +
      sectionHTML("Notas personales", item.notes) +
      '<div style="height:34px"></div>' +
      "</div>";
  }

  function infoItem(label, value, long) {
    if (value == null || value === "") return "";
    return '<div class="info-item"><span class="info-label">' + esc(label) + "</span>" +
      '<span class="info-value' + (long ? " is-long" : "") + '">' + esc(value) + "</span></div>";
  }

  function sectionHTML(title, body) {
    if (!body) return "";
    return '<section class="section"><div class="section-head"><h2>' + esc(title) + "</h2></div>" +
      '<div class="section-body">' + esc(body) + "</div></section>";
  }

  function photoGridHTML(item, editable) {
    var photos = item.photos || [];
    var html = '<div class="photo-grid photo-zone" data-photo-zone="1">';
    if (!photos.length) {
      html += '<button class="photo-empty" type="button" data-action="add-photos">' +
        icon("image") +
        "<strong>Añadir fotografías</strong>" +
        "<span>JPG, PNG o WebP · se optimizan automáticamente</span>" +
        "</button>";
    } else {
      photos.forEach(function (photo, index) {
        html += '<button class="photo" type="button" data-action="lightbox" data-index="' + index +
          '" style="background-image:' + escAttr(cssUrl(photo.thumb || photo.full)) +
          '" aria-label="Ver foto ' + (index + 1) + '">' +
          (index === 0 ? '<span class="photo-tag">' + icon("star") + "Portada</span>" : "") +
          "</button>";
      });
      if (editable) {
        html += '<button class="photo photo-add" type="button" data-action="add-photos">' +
          icon("camera") + "<span>Añadir</span></button>";
      }
    }
    html += "</div>";
    if (editable) {
      html += '<div class="form-photo-tools">' +
        '<button class="action-btn" type="button" data-action="add-photos">' + icon("image") + "Subir fotos</button>" +
        '<button class="action-btn" type="button" data-action="take-photo">' + icon("camera") + "Tomar foto</button>" +
        '<span class="section-note">La primera foto es la portada.</span>' +
        "</div>";
    }
    return html;
  }

  function budgetDetailHTML(item) {
    var keys = Object.keys(item.bud || {});
    if (!keys.length) {
      return '<section class="section"><div class="section-head"><h2>Presupuesto</h2></div>' +
        '<div class="empty-note">Sin presupuesto registrado. Puedes añadirlo al editar el destino.</div></section>';
    }
    var two = !item.visited;
    var rows = keys.map(function (key) {
      var pair = item.bud[key] || [0, 0];
      return '<div class="budget-row' + (two ? " is-two" : "") + '">' +
        "<span>" + esc(CATS[key] || key) + "</span>" +
        '<span class="amount">' + esc(money(pair[0])) + "</span>" +
        (item.visited ? '<span class="amount">' + esc(money(pair[1])) + "</span>" : "") +
        "</div>";
    }).join("");
    var totals = budgetTotals(item);
    var diffClass = totals.difference < 0 ? " is-over" : "";
    return '<section class="section"><div class="section-head"><h2>Presupuesto</h2></div>' +
      '<div class="budget-table">' +
      '<div class="budget-row is-head' + (two ? " is-two" : "") + '"><span>Categoría</span><span class="amount">Estimado</span>' +
      (item.visited ? '<span class="amount">Real</span>' : "") + "</div>" +
      rows +
      '<div class="budget-total">' +
      "<span>Total estimado <b>" + esc(money(totals.estimated)) + "</b></span>" +
      (item.visited ? "<span>Gasto real <b>" + esc(money(totals.actual)) + "</b></span>" : "") +
      (item.visited ? '<span class="budget-diff' + diffClass + '">Diferencia ' + esc(money(totals.difference)) + "</span>" : "") +
      "</div></div></section>";
  }

  function locationDetailHTML(item) {
    if (item.lat == null || item.lng == null) {
      return '<section class="section"><div class="section-head"><h2>Ubicación</h2></div>' +
        '<div class="empty-note">Este destino todavía no tiene ubicación en el mapa. ' +
        '<button class="action-btn" type="button" data-action="edit" data-id="' + escAttr(item.id) + '" style="margin-left:6px">' +
        icon("pin") + "Añadir ubicación</button></div></section>";
    }
    return '<section class="section"><div class="section-head"><h2>Ubicación</h2></div>' +
      '<div class="location-card"><div class="coords">' + icon("pin") +
      esc(item.lat.toFixed(5) + ", " + item.lng.toFixed(5)) + "</div>" +
      '<div class="form-photo-tools">' +
      '<button class="action-btn" type="button" data-action="google-maps" data-id="' + escAttr(item.id) + '">' +
      icon("external") + "Google Maps</button>" +
      '<button class="action-btn" type="button" data-action="copy-coords" data-id="' + escAttr(item.id) + '">' +
      icon("copy") + "Copiar</button>" +
      '<button class="action-btn" type="button" data-action="view-map" data-id="' + escAttr(item.id) + '">' +
      icon("map") + "Centrar</button>" +
      "</div></div></section>";
  }

  /* ------------------------------------------------------------------------
     Formulario
     ------------------------------------------------------------------------ */
  function openForm(id, convert) {
    var source = id ? getItem(id) : null;
    if (id && !source) return;
    ui.D = source ? JSON.parse(JSON.stringify(source)) : {
      id: null,
      name: "",
      prov: "",
      loc: "",
      visited: true,
      lat: null,
      lng: null,
      trip: "",
      desc: "",
      purpose: "",
      reason: "",
      prio: "media",
      start: "",
      end: "",
      notes: "",
      url: "",
      photos: [],
      bud: {}
    };
    if (convert) ui.D.visited = true;
    ui.D.photos = ui.D.photos || [];
    ui.D.bud = ui.D.bud || {};
    ui.dirty = false;
    ui.photoContext = "form";
    openOverlay(formHTML(), "form");
  }

  function formHTML() {
    var d = ui.D;
    var visited = !!d.visited;
    var title = d.id ? "Editar destino" : "Nuevo destino";
    var provinceOptions = PROVINCES.map(function (province) {
      return '<option value="' + escAttr(province) + '"' + (d.prov === province ? " selected" : "") + ">" + esc(province) + "</option>";
    }).join("");
    if (d.prov && PROVINCES.indexOf(d.prov) < 0) {
      provinceOptions = '<option value="' + escAttr(d.prov) + '" selected>' + esc(d.prov) + "</option>" + provinceOptions;
    }

    return '<div class="overlay-head">' +
      '<button class="icon-btn" type="button" data-action="cancel-form" aria-label="Volver">' + icon("arrow-left") + "</button>" +
      '<h1 class="overlay-title">' + esc(title) + "</h1>" +
      (d.id ? '<button class="icon-btn" type="button" data-action="delete" data-id="' + escAttr(d.id) + '" aria-label="Eliminar destino">' + icon("trash") + "</button>" : "") +
      "</div>" +
      '<div class="form-wrap">' +
      '<p class="form-intro">Los campos son opcionales salvo el nombre. Todo se guarda en este navegador; puedes exportar una copia desde Estadísticas.</p>' +

      '<section class="form-card"><h2>Lo esencial</h2>' +
      '<div class="field"><label for="field-name">Nombre del destino <span class="required">*</span></label>' +
      '<input id="field-name" data-k="name" value="' + escAttr(d.name) + '" placeholder="Ej. Bahía de las Águilas" autocomplete="off" maxlength="240"></div>' +
      '<div class="field-row">' +
      '<div class="field"><label for="field-prov">Provincia</label><select id="field-prov" data-k="prov"><option value="">—</option>' + provinceOptions + "</select></div>" +
      '<div class="field"><label for="field-loc">Municipio o localidad</label><input id="field-loc" data-k="loc" value="' + escAttr(d.loc) + '" placeholder="Ej. Cabo Rojo" autocomplete="off"></div>' +
      "</div>" +
      '<div class="field"><span class="field-label">Estado</span><div class="segmented">' +
      '<button type="button" class="' + (visited ? "is-active" : "") + '" data-action="set-visited" data-visited="1">' + icon("check") + "Visitado</button>" +
      '<button type="button" class="' + (!visited ? "is-active" : "") + '" data-action="set-visited" data-visited="0">' + icon("compass") + "Por conocer</button>" +
      "</div></div>" +
      '<div class="field"><label for="field-desc">Descripción</label>' +
      '<textarea id="field-desc" data-k="desc" rows="3" placeholder="¿Cómo es el lugar? ¿Qué te gustaría hacer allí?">' + esc(d.desc) + "</textarea></div>" +
      "</section>" +

      '<section class="form-card"><h2>' + (visited ? "Tu experiencia" : "Lo que te llama") + "</h2>" +
      (visited
        ? '<div class="field"><label for="field-trip">Nombre del viaje</label><input id="field-trip" data-k="trip" value="' + escAttr(d.trip) + '" placeholder="Ej. Escapada a Samaná" autocomplete="off"></div>' +
          '<div class="field-row"><div class="field"><label for="field-start">Fecha de inicio</label><input id="field-start" type="date" data-k="start" value="' + escAttr(d.start) + '"></div>' +
          '<div class="field"><label for="field-end">Fecha de fin</label><input id="field-end" type="date" data-k="end" value="' + escAttr(d.end) + '"></div></div>' +
          '<div class="field"><label for="field-purpose">Motivo del viaje</label><input id="field-purpose" data-k="purpose" value="' + escAttr(d.purpose) + '" placeholder="Ej. Subir a la cumbre" autocomplete="off"></div>'
        : '<div class="field"><label for="field-reason">¿Por qué quieres conocerlo?</label><textarea id="field-reason" data-k="reason" rows="2" placeholder="Qué te motiva a ir">' + esc(d.reason) + "</textarea></div>" +
          '<div class="field"><label for="field-prio">Prioridad</label><select id="field-prio" data-k="prio">' +
          ["baja", "media", "alta"].map(function (priority) {
            return '<option value="' + priority + '"' + (d.prio === priority ? " selected" : "") + ">" + priority.charAt(0).toUpperCase() + priority.slice(1) + "</option>";
          }).join("") + "</select></div>") +
      '<div class="field"><label for="field-notes">Notas personales</label><textarea id="field-notes" data-k="notes" rows="3" placeholder="Recomendaciones, recuerdos, pendientes…">' + esc(d.notes) + "</textarea></div>" +
      "</section>" +

      '<section class="form-card"><h2>Ubicación</h2>' +
      '<div class="field"><label for="field-url">Enlace de Google Maps</label>' +
      '<div style="display:flex;gap:7px;align-items:center"><input id="field-url" data-k="url" value="' + escAttr(d.url) + '" placeholder="Pega aquí el enlace del lugar" inputmode="url" autocomplete="off">' +
      '<button class="btn is-ghost is-small" type="button" data-action="detect-url" style="flex:none">Detectar</button></div>' +
      '<p class="field-hint">También puedes colocar el punto directamente en el mapa o escribir las coordenadas.</p></div>' +
      '<div class="field-row">' +
      '<div class="field"><label for="field-lat">Latitud</label><input id="field-lat" data-k="lat" value="' + (d.lat == null ? "" : escAttr(d.lat)) + '" inputmode="decimal" placeholder="18.4861"></div>' +
      '<div class="field"><label for="field-lng">Longitud</label><input id="field-lng" data-k="lng" value="' + (d.lng == null ? "" : escAttr(d.lng)) + '" inputmode="decimal" placeholder="-69.9312"></div>' +
      "</div>" +
      '<div class="form-photo-tools">' +
      '<button class="action-btn" type="button" data-action="place-location">' + icon("pin") + "Colocar en el mapa</button>" +
      '<button class="action-btn" type="button" data-action="use-geolocation">' + icon("compass") + "Usar mi ubicación</button>" +
      (d.lat != null ? '<button class="action-btn is-danger" type="button" data-action="clear-location">' + icon("x") + "Quitar" + "</button>" : "") +
      "</div></section>" +

      '<section class="form-card"><h2>Fotografías</h2>' +
      photoGridHTML(d, true) +
      "</section>" +

      '<section class="form-card"><h2>Presupuesto <span class="section-note">(opcional)</span></h2>' +
      budgetFormHTML(d, visited) +
      "</section>" +

      '<div class="form-actions"><div class="form-actions-inner">' +
      '<button class="btn is-ghost" type="button" data-action="cancel-form">Cancelar</button>' +
      '<button class="btn is-primary" type="button" data-action="save-item" style="flex:1">' +
      icon("check") + (d.id ? "Guardar cambios" : "Guardar destino") + "</button>" +
      "</div></div>" +
      "</div>";
  }

  function budgetFormHTML(d, visited) {
    var two = !visited;
    var rows = Object.keys(CATS).map(function (key) {
      var pair = d.bud[key] || [0, 0];
      return '<div class="budget-row' + (two ? " is-two" : "") + '"><span>' + esc(CATS[key]) + "</span>" +
        '<input type="number" min="0" step="0.01" inputmode="decimal" data-b="' + key + ':0" value="' + (pair[0] || "") + '" aria-label="' + escAttr(CATS[key]) + ' estimado">' +
        (visited ? '<input type="number" min="0" step="0.01" inputmode="decimal" data-b="' + key + ':1" value="' + (pair[1] || "") + '" aria-label="' + escAttr(CATS[key]) + ' real">' : "") +
        "</div>";
    }).join("");
    return '<div class="budget-table">' +
      '<div class="budget-row is-head' + (two ? " is-two" : "") + '"><span>Categoría</span><span class="amount">Estimado</span>' + (visited ? '<span class="amount">Real</span>' : "") + "</div>" +
      rows +
      '<div class="budget-total" id="budget-total">' + budgetTotalHTML(d, visited) + "</div>" +
      "</div>";
  }

  function budgetTotalHTML(d, visited) {
    var totals = budgetTotals(d);
    var diffClass = totals.difference < 0 ? " is-over" : "";
    return "<span>Total estimado <b>" + esc(money(totals.estimated)) + "</b></span>" +
      (visited ? "<span>Gasto real <b>" + esc(money(totals.actual)) + "</b></span>" +
        '<span class="budget-diff' + diffClass + '">Diferencia ' + esc(money(totals.difference)) + "</span>" : "");
  }

  function updateBudgetTotal() {
    var target = $("budget-total");
    if (!target || !ui.D) return;
    target.innerHTML = budgetTotalHTML(ui.D, !!ui.D.visited);
  }

  function renderForm() {
    if (!ui.D) return;
    var scroll = els.overlay.scrollTop;
    els.overlay.innerHTML = formHTML();
    els.overlay.scrollTop = scroll;
    updateBudgetTotal();
  }

  function onFormInput(event) {
    if (!ui.D) return;
    var target = event.target;
    if (!target || !target.dataset) return;
    var key = target.dataset.k;
    if (key) {
      if (key === "lat" || key === "lng") {
        var raw = target.value.trim();
        ui.D[key] = raw === "" ? null : coordNumber(raw);
      } else {
        ui.D[key] = target.value;
      }
      ui.dirty = true;
    }
    var budgetKey = target.dataset.b;
    if (budgetKey) {
      var parts = budgetKey.split(":");
      var category = parts[0];
      var index = Number(parts[1]) || 0;
      ui.D.bud[category] = ui.D.bud[category] || [0, 0];
      ui.D.bud[category][index] = Math.max(0, number(target.value));
      ui.dirty = true;
      updateBudgetTotal();
    }
  }

  function setVisited(visited) {
    if (!ui.D) return;
    ui.D.visited = !!visited;
    ui.dirty = true;
    renderForm();
  }

  function detectUrl() {
    if (!ui.D) return;
    var url = String(ui.D.url || "").trim();
    if (!url) {
      toast("Pega primero un enlace de Google Maps.");
      return;
    }
    var coords = parseCoordsFromUrl(url);
    if (!coords) {
      toast(/goo\.gl|maps\.app/i.test(url)
        ? "Los enlaces cortos no se pueden leer desde el navegador. Abre el enlace, copia la URL larga o coloca el punto en el mapa."
        : "No se encontraron coordenadas en el enlace. Prueba a colocar el punto en el mapa.");
      return;
    }
    ui.D.lat = coords[0];
    ui.D.lng = coords[1];
    ui.dirty = true;
    renderForm();
    toast("Coordenadas detectadas: " + coords[0].toFixed(5) + ", " + coords[1].toFixed(5));
  }

  function parseCoordsFromUrl(text) {
    var value = String(text || "");
    try { value = decodeURIComponent(value); } catch (error) { /* ignorar */ }
    var patterns = [
      /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
      /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
      /[?&](?:q|query|ll|center|destination|daddr)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
      /geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
      /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/
    ];
    for (var i = 0; i < patterns.length; i++) {
      var match = value.match(patterns[i]);
      if (match) {
        var a = Number(match[1]);
        var b = Number(match[2]);
        if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180) {
          return [a, b];
        }
      }
    }
    return null;
  }

  function useGeolocation() {
    if (!ui.D) return;
    if (!navigator.geolocation) {
      toast("Este navegador no permite obtener la ubicación.");
      return;
    }
    toast("Obteniendo tu ubicación…");
    navigator.geolocation.getCurrentPosition(function (position) {
      if (!ui.D) return;
      ui.D.lat = Number(position.coords.latitude.toFixed(5));
      ui.D.lng = Number(position.coords.longitude.toFixed(5));
      ui.dirty = true;
      renderForm();
      toast("Ubicación actual añadida.");
    }, function () {
      toast("No se pudo obtener la ubicación. Revisa los permisos del navegador.");
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
  }

  async function saveItem() {
    if (!ui.D) return;
    if (ui.uploading) {
      toast("Espera a que terminen de procesarse las fotos.");
      return;
    }
    var d = ui.D;
    var name = String(d.name || "").trim();
    if (!name) {
      toast("Escribe el nombre del destino.");
      focusField("name");
      return;
    }
    if (d.start && d.end && d.end < d.start) {
      toast("La fecha final no puede ser anterior a la inicial.");
      focusField("end");
      return;
    }
    if (d.lat != null && (!Number.isFinite(Number(d.lat)) || Math.abs(Number(d.lat)) > 90)) {
      toast("La latitud debe estar entre -90 y 90.");
      focusField("lat");
      return;
    }
    if (d.lng != null && (!Number.isFinite(Number(d.lng)) || Math.abs(Number(d.lng)) > 180)) {
      toast("La longitud debe estar entre -180 y 180.");
      focusField("lng");
      return;
    }

    var now = Date.now();
    var item = {
      id: d.id || uid(),
      name: name.slice(0, 240),
      prov: String(d.prov || "").trim(),
      loc: String(d.loc || "").trim(),
      visited: !!d.visited,
      lat: d.lat == null ? null : Number(d.lat),
      lng: d.lng == null ? null : Number(d.lng),
      trip: String(d.trip || "").trim(),
      desc: String(d.desc || "").trim(),
      purpose: String(d.purpose || "").trim(),
      reason: String(d.reason || "").trim(),
      prio: ["baja", "media", "alta"].indexOf(d.prio) >= 0 ? d.prio : "",
      start: String(d.start || ""),
      end: String(d.end || ""),
      notes: String(d.notes || "").trim(),
      url: String(d.url || "").trim(),
      photos: (d.photos || []).map(normalizePhoto).filter(Boolean),
      bud: cleanBudget(d.bud),
      created: d.created || now,
      updated: now,
      demo: false
    };
    if (item.lat == null || item.lng == null) {
      item.lat = null;
      item.lng = null;
    }

    var index = S.items.findIndex(function (existing) { return existing.id === item.id; });
    if (index >= 0) S.items[index] = item;
    else S.items.push(item);

    ui.dirty = false;
    var saved = await persist();
    closeOverlay(true);
    ui.sel = item.id;
    renderAll();
    if (item.lat != null && item.lng != null && map) {
      map.flyTo(item.lng, item.lat, Math.max(map.scale, map.homeScale * 2.8), 480);
    }
    toast(saved ? "Destino guardado." : "Destino guardado solo en esta sesión.");
  }

  function focusField(key) {
    var field = document.querySelector('[data-k="' + key + '"]');
    if (!field) return;
    field.classList.add("is-invalid");
    field.focus({ preventScroll: false });
    setTimeout(function () { field.classList.remove("is-invalid"); }, 1800);
  }

  /* ------------------------------------------------------------------------
     Acciones de destinos
     ------------------------------------------------------------------------ */
  function markVisited(id) {
    var item = getItem(id);
    if (!item) return;
    item.visited = true;
    item.updated = Date.now();
    persist();
    renderAll();
    if (ui.overlay === "detail") refreshDetail(id);
    toast("Marcado como visitado.");
  }

  function deleteItem(id) {
    var item = getItem(id);
    if (!item) return;
    confirmDialog({
      title: "Eliminar destino",
      message: "Se eliminará «" + item.name + "» con sus fotos, notas y presupuesto. Esta acción no se puede deshacer.",
      confirmLabel: "Eliminar",
      danger: true,
      onConfirm: async function () {
        S.items = S.items.filter(function (existing) { return existing.id !== id; });
        if (ui.sel === id) ui.sel = null;
        await persist();
        closeOverlay(true);
        renderAll();
        toast("Destino eliminado.");
      }
    });
  }

  async function shareItem(id) {
    var item = getItem(id);
    if (!item) return;
    var lines = [item.name];
    if (item.prov) lines.push(item.prov + (item.loc ? " · " + item.loc : ""));
    lines.push(item.visited ? "Visitado" : "Por conocer");
    var dates = dateRange(item);
    if (dates) lines.push(dates);
    if (item.lat != null && item.lng != null) {
      lines.push("https://www.google.com/maps/search/?api=1&query=" + item.lat + "," + item.lng);
    }
    lines.push("— Mis Aventuras RD");
    var text = lines.join("\n");
    if (navigator.share) {
      try {
        await navigator.share({ title: item.name, text: text });
        return;
      } catch (error) {
        if (error && error.name === "AbortError") return;
      }
    }
    var copied = await copyText(text);
    toast(copied ? "Resumen copiado al portapapeles." : "No se pudo compartir.");
  }

  function openGoogleMaps(id) {
    var item = getItem(id);
    if (!item || item.lat == null || item.lng == null) {
      toast("Este destino no tiene coordenadas.");
      return;
    }
    window.open("https://www.google.com/maps/search/?api=1&query=" + item.lat + "," + item.lng, "_blank", "noopener,noreferrer");
  }

  function copyCoords(id) {
    var item = getItem(id);
    if (!item || item.lat == null) return;
    copyText(item.lat + ", " + item.lng).then(function (copied) {
      toast(copied ? "Coordenadas copiadas." : "No se pudo copiar.");
    });
  }

  function viewOnMap(id) {
    var item = getItem(id);
    if (!item || item.lat == null || item.lng == null) return;
    closeOverlay(true);
    ui.sel = id;
    renderAll();
    if (map) {
      map.flyTo(item.lng, item.lat, Math.max(map.homeScale * 4.2, map.scale), 500);
    }
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (error) { /* usar respaldo */ }
    try {
      var area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      var ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch (error) {
      return false;
    }
  }

  function getItem(id) {
    return S.items.find(function (item) { return item.id === id; }) || null;
  }

  /* ------------------------------------------------------------------------
     Fotos
     ------------------------------------------------------------------------ */
  function openPhotoPicker(camera) {
    ui.photoContext = ui.overlay === "form" ? "form" : (ui.overlay === "detail" ? "detail" : null);
    if (!ui.photoContext) return;
    ui.photoItemId = ui.sel;
    var input = camera ? els.cameraInput : els.photoInput;
    input.value = "";
    input.click();
  }

  function showUploading(show, text) {
    if (show) {
      if (!els.uploading) {
        els.uploading = document.createElement("div");
        els.uploading.className = "uploading";
        els.uploading.innerHTML = '<div class="upload-card"><span class="spinner"></span><span id="upload-text">Optimizando fotos…</span></div>';
        document.body.appendChild(els.uploading);
      }
      var label = $("upload-text");
      if (label) label.textContent = text || "Optimizando fotos…";
      ui.uploading = true;
    } else {
      ui.uploading = false;
      if (els.uploading) {
        els.uploading.remove();
        els.uploading = null;
      }
    }
  }

  async function handlePhotoFiles(files) {
    if (ui.uploading) return;
    var list = Array.prototype.slice.call(files).filter(function (file) {
      return file && /^image\//i.test(file.type);
    });
    if (!list.length) {
      toast("Selecciona archivos de imagen (JPG, PNG o WebP).");
      return;
    }

    var context = ui.photoContext;
    var target = null;
    if (context === "form") target = ui.D;
    else if (context === "detail") target = getItem(ui.photoItemId || ui.sel);
    if (!target) {
      toast("No se encontró el destino para añadir las fotos.");
      return;
    }
    target.photos = target.photos || [];

    var added = 0;
    var failed = 0;
    try {
      for (var i = 0; i < list.length; i++) {
        showUploading(true, "Optimizando " + (i + 1) + " de " + list.length + "…");
        try {
          var photo = await processImageFile(list[i]);
          target.photos.push(photo);
          added++;
        } catch (error) {
          failed++;
        }
      }
    } finally {
      showUploading(false);
    }

    if (!added) {
      toast("No se pudieron leer las imágenes. Prueba con JPG o PNG.");
      return;
    }

    if (context === "form") {
      ui.dirty = true;
      renderForm();
      toast(added + " " + (added === 1 ? "foto añadida" : "fotos añadidas") + (failed ? " · " + failed + " con error" : "") + ".");
    } else {
      var item = getItem(ui.photoItemId || ui.sel);
      if (item) {
        item.updated = Date.now();
        var saved = await persist();
        renderAll();
        refreshDetail(item.id);
        toast(saved
          ? added + " " + (added === 1 ? "foto añadida" : "fotos añadidas") + (failed ? " · " + failed + " con error" : "") + "."
          : "Las fotos están en pantalla, pero no se pudieron guardar. Exporta una copia y libera espacio.");
      }
    }
  }

  function loadImageElement(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var image = new Image();
      image.onload = function () {
        URL.revokeObjectURL(url);
        if (!image.width || !image.height) {
          reject(new Error("Imagen sin dimensiones"));
          return;
        }
        resolve(image);
      };
      image.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("No se pudo decodificar la imagen"));
      };
      image.src = url;
    });
  }

  async function loadImageSource(file) {
    if (window.createImageBitmap) {
      try {
        return await createImageBitmap(file, { imageOrientation: "from-image" });
      } catch (error) {
        try {
          return await createImageBitmap(file);
        } catch (secondError) {
          return loadImageElement(file);
        }
      }
    }
    return loadImageElement(file);
  }

  async function processImageFile(file) {
    var source = await loadImageSource(file);
    var width = source.width || source.naturalWidth;
    var height = source.height || source.naturalHeight;
    if (!width || !height) throw new Error("Imagen vacía");

    var maxFull = 1600;
    var scale = Math.min(1, maxFull / Math.max(width, height));
    var fullWidth = Math.max(1, Math.round(width * scale));
    var fullHeight = Math.max(1, Math.round(height * scale));

    var canvas = document.createElement("canvas");
    canvas.width = fullWidth;
    canvas.height = fullHeight;
    var context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, fullWidth, fullHeight);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(source, 0, 0, fullWidth, fullHeight);

    var full = canvas.toDataURL("image/jpeg", 0.82);
    if (full.length > 3200000) {
      full = canvas.toDataURL("image/jpeg", 0.68);
    }

    var maxThumb = 480;
    var thumbScale = Math.min(1, maxThumb / Math.max(width, height));
    var thumbWidth = Math.max(1, Math.round(width * thumbScale));
    var thumbHeight = Math.max(1, Math.round(height * thumbScale));
    var thumbCanvas = document.createElement("canvas");
    thumbCanvas.width = thumbWidth;
    thumbCanvas.height = thumbHeight;
    var thumbContext = thumbCanvas.getContext("2d");
    thumbContext.fillStyle = "#ffffff";
    thumbContext.fillRect(0, 0, thumbWidth, thumbHeight);
    thumbContext.imageSmoothingEnabled = true;
    thumbContext.imageSmoothingQuality = "high";
    thumbContext.drawImage(source, 0, 0, thumbWidth, thumbHeight);
    var thumb = thumbCanvas.toDataURL("image/jpeg", 0.76);

    if (source.close) source.close();

    return {
      id: uid(),
      full: full,
      thumb: thumb,
      w: fullWidth,
      h: fullHeight,
      added: Date.now()
    };
  }

  /* ------------------------------------------------------------------------
     Lightbox
     ------------------------------------------------------------------------ */
  function openLightbox(index) {
    if (ui.overlay === "form") {
      ui.pvSource = "form";
      ui.pvList = (ui.D && ui.D.photos) || [];
    } else {
      var item = getItem(ui.sel);
      ui.pvSource = "detail";
      ui.pvList = (item && item.photos) || [];
    }
    if (!ui.pvList.length) return;
    ui.pvIndex = clamp(index || 0, 0, ui.pvList.length - 1);
    els.lightbox.hidden = false;
    renderLightbox();
    updateMapEnabled();
  }

  function renderLightbox() {
    var photo = ui.pvList[ui.pvIndex];
    if (!photo) {
      closeLightbox();
      return;
    }
    var item = ui.pvSource === "form" ? ui.D : getItem(ui.sel);
    var title = item ? item.name : "Fotografía";
    var hasMultiple = ui.pvList.length > 1;
    els.lightbox.innerHTML =
      '<div class="lb-top"><span class="lb-count">' + (ui.pvIndex + 1) + " / " + ui.pvList.length + "</span>" +
      '<button class="lb-close" type="button" data-action="lightbox-close" aria-label="Cerrar">' + icon("x") + "</button></div>" +
      '<div class="lb-stage"><img class="lb-img" src="' + escAttr(photo.full || photo.thumb) + '" alt="' + escAttr(title + " — foto " + (ui.pvIndex + 1)) + '" draggable="false"></div>' +
      (hasMultiple
        ? '<button class="lb-nav is-prev" type="button" data-action="lightbox-prev" aria-label="Foto anterior">' + icon("chevron-left") + "</button>" +
          '<button class="lb-nav is-next" type="button" data-action="lightbox-next" aria-label="Foto siguiente">' + icon("chevron-right") + "</button>"
        : "") +
      '<div class="lb-actions">' +
      (ui.pvIndex > 0
        ? '<button class="action-btn" type="button" data-action="set-cover" data-index="' + ui.pvIndex + '">' + icon("star") + "Usar como portada</button>"
        : "") +
      '<button class="action-btn" type="button" data-action="download-photo">' + icon("download") + "Descargar</button>" +
      '<button class="action-btn is-danger" type="button" data-action="delete-photo" data-index="' + ui.pvIndex + '">' + icon("trash") + "Eliminar</button>" +
      "</div>";
  }

  function lightboxStep(direction) {
    if (!ui.pvList.length) return;
    ui.pvIndex = (ui.pvIndex + direction + ui.pvList.length) % ui.pvList.length;
    renderLightbox();
  }

  function closeLightbox() {
    els.lightbox.hidden = true;
    els.lightbox.innerHTML = "";
    ui.pvList = [];
    ui.pvSource = null;
    updateMapEnabled();
  }

  function bindLightboxSwipe() {
    var start = null;
    els.lightbox.addEventListener("pointerdown", function (event) {
      if (event.target.closest("button")) return;
      start = { x: event.clientX, y: event.clientY };
    });
    els.lightbox.addEventListener("pointerup", function (event) {
      if (!start) return;
      var dx = event.clientX - start.x;
      var dy = event.clientY - start.y;
      start = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.35) {
        lightboxStep(dx < 0 ? 1 : -1);
      }
    });
    els.lightbox.addEventListener("pointercancel", function () { start = null; });
  }

  async function setCover(index) {
    if (!ui.pvList.length) return;
    var photo = ui.pvList[index];
    if (!photo) return;
    if (ui.pvSource === "form") {
      if (!ui.D) return;
      ui.D.photos = ui.D.photos.filter(function (p) { return p.id !== photo.id; });
      ui.D.photos.unshift(photo);
      ui.dirty = true;
      closeLightbox();
      renderForm();
      toast("Portada actualizada. Guarda para conservar el cambio.");
      return;
    }
    var item = getItem(ui.sel);
    if (!item) return;
    item.photos = item.photos.filter(function (p) { return p.id !== photo.id; });
    item.photos.unshift(photo);
    item.updated = Date.now();
    await persist();
    closeLightbox();
    renderAll();
    refreshDetail(item.id);
    toast("Portada actualizada.");
  }

  async function deletePhoto(index) {
    var item = ui.pvSource === "form" ? ui.D : getItem(ui.sel);
    if (!item || !item.photos || !item.photos[index]) return;
    var photoId = item.photos[index].id;
    confirmDialog({
      title: "Eliminar foto",
      message: "Esta foto se quitará del destino. Si aún no has guardado, el cambio se descartará al salir.",
      confirmLabel: "Eliminar foto",
      danger: true,
      onConfirm: async function () {
        item.photos = item.photos.filter(function (photo) { return photo.id !== photoId; });
        if (ui.pvSource === "form") {
          ui.dirty = true;
          closeLightbox();
          renderForm();
          toast("Foto eliminada del borrador.");
        } else {
          item.updated = Date.now();
          await persist();
          closeLightbox();
          renderAll();
          refreshDetail(item.id);
          toast("Foto eliminada.");
        }
      }
    });
  }

  function downloadPhoto() {
    var photo = ui.pvList[ui.pvIndex];
    if (!photo) return;
    var item = ui.pvSource === "form" ? ui.D : getItem(ui.sel);
    var name = (item ? item.name : "foto").toLowerCase().replace(/[^a-z0-9áéíóúñ]+/gi, "-").replace(/^-+|-+$/g, "") || "foto";
    if (!/^data:/i.test(photo.full)) {
      window.open(photo.full, "_blank", "noopener,noreferrer");
      return;
    }
    var link = document.createElement("a");
    link.href = photo.full;
    link.download = name + "-" + (ui.pvIndex + 1) + ".jpg";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  /* ------------------------------------------------------------------------
     Estadísticas, datos y respaldo
     ------------------------------------------------------------------------ */
  function renderStats() {
    var visited = S.items.filter(function (item) { return item.visited; });
    var pending = S.items.filter(function (item) { return !item.visited; });
    var provinces = new Set(S.items.map(function (item) { return item.prov; }).filter(Boolean));
    var photos = S.items.reduce(function (sum, item) { return sum + (item.photos ? item.photos.length : 0); }, 0);
    var totalSpent = S.items.reduce(function (sum, item) { return sum + budgetTotals(item).actual; }, 0);
    var totalEstimated = S.items.reduce(function (sum, item) { return sum + budgetTotals(item).estimated; }, 0);
    var progress = S.items.length ? Math.round((visited.length / S.items.length) * 100) : 0;
    var theme = currentTheme();
    var demoCount = S.items.filter(function (item) { return item.demo; }).length;

    var provinceCounts = {};
    S.items.forEach(function (item) {
      if (item.prov) provinceCounts[item.prov] = (provinceCounts[item.prov] || 0) + 1;
    });

    var recent = S.items.filter(function (item) { return item.visited; }).slice().sort(function (a, b) {
      var dateA = a.start || "";
      var dateB = b.start || "";
      if (dateA !== dateB) return dateB.localeCompare(dateA);
      return b.updated - a.updated;
    }).slice(0, 5);

    var recentHTML = recent.length
      ? recent.map(function (item) {
          var thumb = photoThumb(item);
          return '<button class="recent-item" type="button" data-action="detail" data-id="' + escAttr(item.id) + '">' +
            '<span class="recent-thumb"' + (thumb ? ' style="background-image:' + escAttr(cssUrl(thumb)) + '"' : "") + "></span>" +
            '<span class="recent-body"><span class="recent-name">' + esc(item.name) + "</span>" +
            '<span class="recent-meta">' + esc([item.prov, fmtDate(item.start)].filter(Boolean).join(" · ")) + "</span></span>" +
            "</button>";
        }).join("")
      : '<div class="empty-note">Aún no hay visitas con fecha. Marca un destino como visitado para verlo aquí.</div>';

    var html = '<div class="overlay-head">' +
      '<button class="icon-btn" type="button" data-action="close-overlay" aria-label="Volver">' + icon("arrow-left") + "</button>" +
      '<h1 class="overlay-title">Estadísticas y datos</h1>' +
      "</div>" +
      '<div class="overlay-inner">' +
      '<div class="stats-grid">' +
      '<div class="stat-card"><span class="stat-value">' + NUMBER_FORMAT.format(S.items.length) + '</span><span class="stat-label">Destinos</span></div>' +
      '<div class="stat-card is-accent"><span class="stat-value">' + NUMBER_FORMAT.format(visited.length) + '</span><span class="stat-label">Visitados</span></div>' +
      '<div class="stat-card"><span class="stat-value">' + NUMBER_FORMAT.format(pending.length) + '</span><span class="stat-label">Por conocer</span></div>' +
      '<div class="stat-card"><span class="stat-value">' + provinces.size + '/32</span><span class="stat-label">Provincias</span></div>' +
      '<div class="stat-card"><span class="stat-value">' + NUMBER_FORMAT.format(photos) + '</span><span class="stat-label">Fotos</span></div>' +
      '<div class="stat-card"><span class="stat-value" style="font-size:21px">' + esc(moneyShort(totalSpent)) + '</span><span class="stat-label">Gasto real</span></div>' +
      "</div>" +

      '<section class="section"><div class="section-head"><h2>Progreso</h2><span class="section-note">' + progress + "% visitado</span></div>" +
      '<div class="progress"><div class="progress-bar" style="width:' + progress + '%"></div></div>' +
      '<div class="progress-meta"><span>' + plural(visited.length, "visitado") + "</span><span>" + plural(pending.length, "pendiente") + "</span></div></section>" +

      (totalEstimated || totalSpent
        ? '<section class="section"><div class="section-head"><h2>Presupuesto global</h2></div><div class="info-grid">' +
          infoItem("Estimado", money(totalEstimated)) +
          infoItem("Gasto real", money(totalSpent)) +
          infoItem("Diferencia", money(totalEstimated - totalSpent)) +
          "</div></section>"
        : "") +

      '<section class="section"><div class="section-head"><h2>Provincias</h2><span class="section-note">' + provinces.size + " de 32</span></div>" +
      '<div class="province-grid">' + PROVINCES.map(function (province) {
        var count = provinceCounts[province] || 0;
        return '<div class="province-chip' + (count ? " has" : "") + '" title="' + escAttr(count ? plural(count, "destino") : "Sin destinos") + '">' +
          "<span>" + esc(province) + "</span>" + (count ? "<b>" + count + "</b>" : "") + "</div>";
      }).join("") + "</div></section>" +

      '<section class="section"><div class="section-head"><h2>Visitados recientemente</h2></div><div class="recent-list">' + recentHTML + "</div></section>" +

      '<section class="section"><div class="section-head"><h2>Apariencia</h2></div>' +
      '<div class="theme-options">' +
      '<button type="button" class="' + (theme === "auto" ? "is-active" : "") + '" data-action="set-theme" data-theme-value="auto">Automático</button>' +
      '<button type="button" class="' + (theme === "light" ? "is-active" : "") + '" data-action="set-theme" data-theme-value="light">Claro</button>' +
      '<button type="button" class="' + (theme === "dark" ? "is-active" : "") + '" data-action="set-theme" data-theme-value="dark">Oscuro</button>' +
      "</div></section>" +

      '<section class="section"><div class="section-head"><h2>Datos y respaldo</h2></div><div class="data-list">' +
      '<div class="data-row"><span class="data-icon">' + icon("settings") + "</span>" +
      '<span class="data-body"><span class="data-title">Copia completa (ZIP)</span><span class="data-sub">Comparte, exporta o restaura destinos y fotos desde la tuerca.</span></span>' +
      '<button class="action-btn" type="button" data-action="open-backup">Abrir</button></div>' +
      '<div class="data-row"><span class="data-icon">' + icon("database") + "</span>" +
      '<span class="data-body"><span class="data-title">Almacenamiento</span><span class="data-sub" id="storage-info">Calculando…</span></span>' +
      '<button class="action-btn" type="button" data-action="persist-storage">Proteger</button></div>' +
      "</div>" +
      '<p class="fine-print">Los datos se guardan en este navegador y en este dispositivo. Usa la tuerca de arriba para compartir, exportar o importar una copia completa con fotos. El importador también acepta los JSON antiguos.</p>' +
      '<p class="fine-print">Mapa: geoBoundaries ADM0 (Caribbean GeoPortal, CC BY 4.0), contorno simplificado para uso web.</p>' +
      "</section>" +

      '<section class="section danger-zone"><div class="section-head"><h2>Zona delicada</h2></div><div class="data-list">' +
      (demoCount
        ? '<div class="data-row"><span class="data-icon">' + icon("compass") + "</span>" +
          '<span class="data-body"><span class="data-title">Quitar ejemplos</span><span class="data-sub">Elimina solo los ' + demoCount + ' destinos marcados como demo.</span></span>' +
          '<button class="action-btn" type="button" data-action="remove-demo">Quitar</button></div>'
        : "") +
      '<div class="data-row"><span class="data-icon">' + icon("trash") + "</span>" +
      '<span class="data-body"><span class="data-title">Borrar todos los datos</span><span class="data-sub">Destinos, fotos y presupuesto de este navegador.</span></span>' +
      '<button class="action-btn is-danger" type="button" data-action="clear-all">Borrar</button></div>' +
      "</div></section>" +

      '<p class="app-version">Mis Aventuras RD · v' + APP_VERSION + "</p>" +
      "</div>";

    openOverlay(html, "stats");
    loadStorageInfo();
  }

  async function loadStorageInfo() {
    var target = $("storage-info");
    if (!target) return;
    var parts = [];
    try {
      if (navigator.storage && navigator.storage.estimate) {
        var estimate = await navigator.storage.estimate();
        if (estimate.usage != null) {
          parts.push(formatBytes(estimate.usage) + " usados");
        }
        if (estimate.quota) {
          parts.push(formatBytes(estimate.quota) + " disponibles");
        }
      }
      if (navigator.storage && navigator.storage.persisted) {
        var persisted = await navigator.storage.persisted();
        parts.push(persisted ? "almacenamiento protegido" : "puede liberarse si falta espacio");
      }
    } catch (error) { /* sin datos */ }
    if (!parts.length) parts.push("guardado en este navegador");
    var current = $("storage-info");
    if (current) current.textContent = parts.join(" · ");
  }

  async function requestPersistentStorage() {
    if (!navigator.storage || !navigator.storage.persist) {
      toast("Este navegador no permite proteger el almacenamiento.");
      return;
    }
    try {
      var granted = await navigator.storage.persist();
      toast(granted ? "Almacenamiento protegido contra borrados automáticos." : "El navegador no concedió la protección.");
    } catch (error) {
      toast("No se pudo proteger el almacenamiento.");
    }
    loadStorageInfo();
  }

  function backupFileName(date) {
    var pad = function (value) { return String(value).padStart(2, "0"); };
    return "MisAventurasRD_" + date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" +
      pad(date.getDate()) + "_" + pad(date.getHours()) + "-" + pad(date.getMinutes()) + "-" +
      pad(date.getSeconds()) + ".zip";
  }

  function formatBackupDate(value) {
    if (!value) return "";
    var date = value instanceof Date ? value : new Date(value);
    if (isNaN(date.getTime())) return "";
    try {
      return new Intl.DateTimeFormat("es-DO", { dateStyle: "medium", timeStyle: "short" }).format(date);
    } catch (error) {
      return date.toLocaleString("es-DO");
    }
  }

  function dataUrlToBytes(value) {
    var url = String(value == null ? "" : value);
    var match = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/i.exec(url);
    if (!match) return null;
    var mime = match[1] || "application/octet-stream";
    var payload = match[3];
    try {
      if (match[2]) {
        var binary = atob(payload);
        var bytes = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return { mime: mime, bytes: bytes };
      }
      return { mime: mime, bytes: new TextEncoder().encode(decodeURIComponent(payload)) };
    } catch (error) {
      return null;
    }
  }

  function bytesToDataUrl(bytes, mime) {
    return new Promise(function (resolve, reject) {
      try {
        var blob = new Blob([bytes], { type: mime || "application/octet-stream" });
        var reader = new FileReader();
        reader.onload = function () { resolve(String(reader.result)); };
        reader.onerror = function () { reject(reader.error || new Error("No se pudo leer la foto")); };
        reader.readAsDataURL(blob);
      } catch (error) {
        reject(error);
      }
    });
  }

  function extensionForMime(mime) {
    var type = String(mime || "").toLowerCase();
    if (type === "image/png") return "png";
    if (type === "image/webp") return "webp";
    if (type === "image/gif") return "gif";
    if (type === "image/avif") return "avif";
    return "jpg";
  }

  function mimeForName(name) {
    var extension = String(name || "").split(".").pop().toLowerCase();
    var types = {
      png: "image/png",
      webp: "image/webp",
      gif: "image/gif",
      avif: "image/avif",
      jpg: "image/jpeg",
      jpeg: "image/jpeg"
    };
    return types[extension] || "image/jpeg";
  }

  function totalPhotos() {
    return S.items.reduce(function (sum, item) {
      return sum + (item.photos && item.photos.length ? item.photos.length : 0);
    }, 0);
  }

  function backupReadme(date, counts) {
    return [
      "Mis Aventuras RD — Copia de seguridad",
      "",
      "Creada: " + date.toLocaleString("es-DO"),
      "Destinos: " + counts.items,
      "Fotos: " + counts.photos,
      "",
      "Contenido:",
      "- datos.json: destinos, presupuesto y ajustes.",
      "- fotos/: fotos y miniaturas.",
      "",
      "Cómo restaurar:",
      "1. Abre Mis Aventuras RD.",
      "2. Toca la tuerca y elige «Importar copia».",
      "3. Selecciona este archivo ZIP.",
      "4. Elige «Reemplazar todo» o «Combinar».",
      "",
      "No edites datos.json a mano si no sabes lo que haces.",
      ""
    ].join("\n");
  }

  async function buildBackup(options) {
    if (!window.SimpleZip || typeof window.SimpleZip.create !== "function") {
      throw new Error("No se pudo cargar el módulo ZIP.");
    }
    var opts = options || {};
    var onProgress = typeof opts.onProgress === "function" ? opts.onProgress : function () {};
    var createdAt = new Date();
    var entries = [];
    var outputItems = [];
    var photoTotal = totalPhotos();
    var photosDone = 0;
    var included = 0;
    var missing = 0;
    var usedNames = new Set();

    function uniqueEntryName(candidate) {
      var name = candidate;
      var index = 2;
      while (usedNames.has(name)) {
        name = candidate.replace(/(\.[^.\/]+)$/, "-" + index + "$1");
        index++;
      }
      usedNames.add(name);
      return name;
    }

    async function tickPhotoProgress() {
      if (photosDone % 3 === 0 || photosDone === photoTotal) {
        onProgress(photosDone, photoTotal, "Empaquetando fotos…");
        await nextPaint();
      }
    }

    for (var i = 0; i < S.items.length; i++) {
      var item = S.items[i];
      var copy = {};
      Object.keys(item).forEach(function (key) {
        if (key !== "photos") copy[key] = item[key];
      });
      copy.photos = [];
      var photos = Array.isArray(item.photos) ? item.photos : [];

      for (var j = 0; j < photos.length; j++) {
        var photo = photos[j] || {};
        var source = photo.full || photo.thumb || "";
        var parsed = /^data:image\//i.test(source) ? dataUrlToBytes(source) : null;

        if (!parsed) {
          if (source && !/^data:/i.test(source)) {
            // Una foto remota se conserva como URL; no hay archivo que empaquetar.
            copy.photos.push(photo);
            included++;
          } else {
            missing++;
          }
          photosDone++;
          await tickPhotoProgress();
          continue;
        }

        var folder = "fotos/" + (validId(item.id) || "destino") + "/";
        var base = folder + (validId(photo.id) || uid());
        var extension = extensionForMime(parsed.mime);
        var fullName = uniqueEntryName(base + "." + extension);
        entries.push({ name: fullName, data: parsed.bytes });

        var meta = {
          id: photo.id,
          w: photo.w,
          h: photo.h,
          added: photo.added,
          mime: parsed.mime,
          file: fullName
        };

        var thumb = photo.thumb && photo.thumb !== source ? photo.thumb : "";
        if (thumb && /^data:image\//i.test(thumb)) {
          var thumbParsed = dataUrlToBytes(thumb);
          if (thumbParsed) {
            var thumbName = uniqueEntryName(base + "-min." + extensionForMime(thumbParsed.mime));
            entries.push({ name: thumbName, data: thumbParsed.bytes });
            meta.thumbFile = thumbName;
            meta.thumbMime = thumbParsed.mime;
          }
        }

        copy.photos.push(meta);
        included++;
        photosDone++;

        await tickPhotoProgress();
      }

      outputItems.push(copy);
    }

    var counts = { items: outputItems.length, photos: included };
    var payload = {
      app: APP_ID,
      format: BACKUP_FORMAT,
      appVersion: APP_VERSION,
      createdAt: createdAt.toISOString(),
      createdAtLocal: createdAt.toLocaleString("es-DO"),
      counts: counts,
      settings: { theme: currentTheme() },
      items: outputItems
    };

    entries.unshift({ name: "datos.json", data: JSON.stringify(payload, null, 2) });
    entries.push({ name: "LEEME.txt", data: backupReadme(createdAt, counts) });

    onProgress(photosDone, photoTotal, "Empaquetando archivos…");
    await nextPaint();
    var blob = await window.SimpleZip.create(entries, {
      date: createdAt,
      onProgress: function (done, total) {
        if (total > 0) updateBusy("Empaquetando archivos…", done / total);
      }
    });

    return {
      blob: blob,
      name: backupFileName(createdAt),
      createdAt: createdAt,
      counts: counts,
      missing: missing
    };
  }

  function downloadBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  async function getBackup() {
    if (ui.busy) return null;
    showBusy("Preparando copia…", "Reuniendo destinos y fotos.");
    try {
      var backup = await buildBackup({
        onProgress: function (done, total, label) {
          if (total > 0) updateBusy(label + " " + done + " de " + total, done / total);
          else updateBusy(label || "Preparando copia…");
        }
      });
      return backup;
    } catch (error) {
      console.error(error);
      toast(error && error.message ? error.message : "No se pudo crear la copia. Intenta de nuevo.");
      return null;
    } finally {
      hideBusy();
    }
  }

  async function shareBackup() {
    closeGearMenu();
    var backup = await getBackup();
    if (!backup) return;

    var file = null;
    try {
      file = new File([backup.blob], backup.name, { type: "application/zip" });
    } catch (error) {
      file = null;
    }

    if (file && typeof navigator.share === "function") {
      var shareData = { files: [file], title: "Mis Aventuras RD" };
      var canShare = true;
      if (typeof navigator.canShare === "function") {
        try { canShare = navigator.canShare(shareData); } catch (error) { canShare = false; }
      }
      if (canShare) {
        try {
          await navigator.share(shareData);
          toast(backup.missing
            ? "Copia compartida. " + backup.missing + " fotos no se pudieron incluir."
            : "Copia compartida.");
          return;
        } catch (error) {
          if (error && error.name === "AbortError") return;
          console.warn("No se pudo compartir el ZIP:", error);
        }
      }
    }

    downloadBlob(backup.blob, backup.name);
    toast(backup.missing
      ? "Se descargó la copia, pero " + backup.missing + " fotos no se pudieron incluir."
      : "Este navegador no comparte archivos; se descargó el ZIP.");
  }

  async function exportBackup() {
    closeGearMenu();
    var backup = await getBackup();
    if (!backup) return;
    downloadBlob(backup.blob, backup.name);
    toast(backup.missing
      ? "Copia descargada, pero " + backup.missing + " fotos no se pudieron incluir."
      : "Copia descargada: " + backup.name);
  }

  function openImportPicker() {
    if (ui.busy) return;
    closeGearMenu();
    els.importInput.click();
  }

  async function handleImportFile(file) {
    if (!file || ui.busy) return;
    if (file.size > MAX_IMPORT_BYTES) {
      toast("La copia es demasiado grande para este teléfono.");
      return;
    }

    showBusy("Abriendo copia…", file.name);
    try {
      var buffer = await file.arrayBuffer();
      var header = buffer.byteLength >= 4 ? new DataView(buffer).getUint32(0, true) : 0;
      var isZip = /\.zip$/i.test(file.name) ||
        file.type === "application/zip" ||
        file.type === "application/x-zip-compressed" ||
        header === 0x04034B50;
      if (isZip) await importZipBuffer(buffer);
      else await importJsonBuffer(buffer);
    } catch (error) {
      console.error(error);
      toast(error && error.message ? error.message : "No se pudo importar la copia.");
    } finally {
      hideBusy();
    }
  }

  function zipEntry(zip, name) {
    var key = String(name == null ? "" : name).replace(/\\/g, "/").replace(/^\.\/+/, "");
    return key && zip.entries.get(key);
  }

  async function importZipBuffer(buffer) {
    if (!window.SimpleZip || typeof window.SimpleZip.read !== "function") {
      throw new Error("No se pudo cargar el lector ZIP.");
    }
    updateBusy("Leyendo archivo…");
    var zip = await window.SimpleZip.read(buffer, {
      onProgress: function (done, total) {
        if (total > 0) updateBusy("Revisando archivo " + done + " de " + total + "…", done / total);
      }
    });

    var dataEntry = zipEntry(zip, "datos.json");
    if (!dataEntry) {
      zip.entries.forEach(function (value, key) {
        if (!dataEntry && key.toLowerCase() === "datos.json") dataEntry = value;
      });
    }
    if (!dataEntry) {
      throw new Error("El ZIP no contiene datos.json. ¿Es una copia de Mis Aventuras RD?");
    }

    var payload;
    try {
      payload = JSON.parse(new TextDecoder().decode(dataEntry.data));
    } catch (error) {
      throw new Error("El datos.json de la copia está dañado.");
    }
    if (!payload || payload.app !== APP_ID) {
      throw new Error("Este ZIP no es una copia de Mis Aventuras RD.");
    }
    if (payload.format && Number(payload.format) > BACKUP_FORMAT) {
      throw new Error("La copia es de una versión más nueva de la app. Actualiza primero.");
    }
    if (!Array.isArray(payload.items) || !payload.items.length) {
      throw new Error("La copia no contiene destinos.");
    }

    var items = [];
    var photoFiles = 0;
    var missing = 0;

    for (var i = 0; i < payload.items.length; i++) {
      var raw = payload.items[i];
      if (!raw || typeof raw !== "object") continue;
      var item = {};
      Object.keys(raw).forEach(function (key) {
        if (key !== "photos") item[key] = raw[key];
      });
      item.photos = [];
      var photos = Array.isArray(raw.photos) ? raw.photos : [];

      for (var j = 0; j < photos.length; j++) {
        var photo = photos[j] || {};
        if (photo.file) {
          var fullEntry = zipEntry(zip, photo.file);
          if (!fullEntry) {
            missing++;
            continue;
          }
          var mime = photo.mime || mimeForName(photo.file);
          var full = await bytesToDataUrl(fullEntry.data, mime);
          var thumb = full;
          if (photo.thumbFile) {
            var thumbEntry = zipEntry(zip, photo.thumbFile);
            if (thumbEntry) {
              thumb = await bytesToDataUrl(thumbEntry.data, photo.thumbMime || mimeForName(photo.thumbFile));
            }
          }
          item.photos.push({
            id: photo.id,
            full: full,
            thumb: thumb,
            w: photo.w,
            h: photo.h,
            added: photo.added
          });
          photoFiles++;
        } else if (photo.full || photo.thumb) {
          item.photos.push(photo);
          photoFiles++;
        }
      }

      var normalized = normalizeItem(item);
      if (normalized) items.push(normalized);
    }

    if (!items.length) {
      throw new Error("No se encontraron destinos válidos en la copia.");
    }

    hideBusy();
    showRestoreDialog({
      items: items,
      createdAt: payload.createdAt || payload.createdAtLocal || "",
      source: "ZIP",
      photos: photoFiles,
      missing: missing
    });
  }

  async function importJsonBuffer(buffer) {
    var data;
    try {
      data = JSON.parse(new TextDecoder().decode(buffer));
    } catch (error) {
      throw new Error("El archivo no es un JSON válido.");
    }
    if (data && data.app && data.app !== APP_ID) {
      throw new Error("Este archivo no es una copia de Mis Aventuras RD.");
    }
    var rawItems = Array.isArray(data) ? data : data && data.items;
    if (!Array.isArray(rawItems)) {
      throw new Error("El archivo no contiene una lista de destinos.");
    }
    var items = rawItems.map(normalizeItem).filter(Boolean);
    if (!items.length) {
      throw new Error("No se encontraron destinos válidos en el archivo.");
    }

    hideBusy();
    showRestoreDialog({
      items: items,
      createdAt: (data && data.exportedAt) || "",
      source: "JSON",
      photos: items.reduce(function (sum, item) { return sum + item.photos.length; }, 0),
      missing: 0
    });
  }

  function showRestoreDialog(info) {
    var details = [plural(info.items.length, "destino")];
    if (info.photos) details.push(plural(info.photos, "foto"));
    if (info.missing) details.push(info.missing + " fotos no encontradas");
    var dateText = formatBackupDate(info.createdAt);
    var source = info.source === "ZIP" ? "Copia ZIP" : "Archivo JSON";

    ui.restoreActions = { items: info.items };
    openDialog(
      '<div class="dialog-card" role="dialog" aria-modal="true" aria-labelledby="restore-title">' +
      '<h2 id="restore-title">Restaurar copia</h2>' +
      "<p>" + esc(source) + (dateText ? " del " + esc(dateText) : "") + " · " + esc(details.join(" · ")) + ".</p>" +
      '<p class="dialog-hint">«Combinar» conserva tus destinos actuales y actualiza los que tengan el mismo ID. «Reemplazar todo» deja solo los destinos de la copia.</p>' +
      '<div class="dialog-actions is-stacked">' +
      '<button class="btn is-ghost" type="button" data-action="dialog-cancel">Cancelar</button>' +
      '<button class="btn is-ghost" type="button" data-action="restore-merge">Combinar</button>' +
      '<button class="btn is-primary" type="button" data-action="restore-replace">Reemplazar todo</button>' +
      "</div></div>"
    );
    var cancel = els.dialog.querySelector('[data-action="dialog-cancel"]');
    if (cancel) cancel.focus({ preventScroll: true });
  }

  async function runRestore(mode) {
    var actions = ui.restoreActions;
    if (!actions || !actions.items) return;
    var items = actions.items;
    closeDialog();
    showBusy(mode === "replace" ? "Restaurando copia…" : "Combinando copia…", "Guardando destinos y fotos.");
    await nextPaint();
    try {
      await applyRestore(items, mode);
    } finally {
      hideBusy();
    }
  }

  async function applyRestore(items, mode) {
    var previous = S.items;
    var added = 0;
    var updated = 0;

    if (mode === "replace") {
      S.items = items.slice();
      added = items.length;
    } else {
      var mapById = new Map();
      S.items.forEach(function (item) { mapById.set(item.id, item); });
      items.forEach(function (item) {
        if (mapById.has(item.id)) updated++;
        else added++;
        mapById.set(item.id, item);
      });
      S.items = Array.from(mapById.values());
    }

    var saved = await persist();
    if (!saved) {
      S.items = previous;
      await persist();
      toast("No se pudo guardar la copia. Se mantuvieron tus datos actuales.");
      return;
    }

    if (ui.sel && !getItem(ui.sel)) ui.sel = null;
    renderAll();
    if (ui.overlay === "stats") renderStats();
    toast(mode === "replace"
      ? "Copia restaurada: " + plural(items.length, "destino") + "."
      : added + " nuevos · " + updated + " actualizados.");
  }

  function removeDemo() {
    var count = S.items.filter(function (item) { return item.demo; }).length;
    if (!count) return;
    confirmDialog({
      title: "Quitar ejemplos",
      message: "Se eliminarán " + plural(count, "destino") + " marcados como demo. Tus destinos propios no se tocarán.",
      confirmLabel: "Quitar ejemplos",
      danger: true,
      onConfirm: async function () {
        S.items = S.items.filter(function (item) { return !item.demo; });
        if (ui.sel && !getItem(ui.sel)) ui.sel = null;
        await persist();
        renderAll();
        if (ui.overlay === "stats") renderStats();
        toast("Ejemplos eliminados.");
      }
    });
  }

  function clearAll() {
    confirmDialog({
      title: "Borrar todos los datos",
      message: "Se borrarán todos los destinos, fotos y presupuestos de este navegador. Exporta una copia antes si quieres conservarlos. Esta acción no se puede deshacer.",
      confirmLabel: "Borrar todo",
      danger: true,
      onConfirm: async function () {
        S.items = [];
        ui.sel = null;
        ui.query = "";
        ui.filter = "all";
        els.search.value = "";
        updateSearchClear();
        await persist();
        closeOverlay(true);
        renderAll();
        toast("Todos los datos fueron borrados.");
      }
    });
  }

  async function loadDemo() {
    var added = 0;
    DEMO.forEach(function (demo) {
      if (S.items.some(function (item) { return item.id === demo.id; })) return;
      var item = normalizeItem(Object.assign({}, demo, {
        demo: true,
        photos: [],
        created: Date.now(),
        updated: Date.now()
      }));
      if (item) {
        S.items.push(item);
        added++;
      }
    });
    if (!added) {
      toast("Los ejemplos ya están cargados.");
      return;
    }
    await persist();
    renderAll();
    toast(added + " " + (added === 1 ? "ejemplo cargado" : "ejemplos cargados") + ". Puedes quitarlos desde Estadísticas.");
  }

  /* ------------------------------------------------------------------------
     Diálogos
     ------------------------------------------------------------------------ */
  function openDialog(html) {
    els.dialog.innerHTML = html;
    els.dialog.hidden = false;
    updateMapEnabled();
    var focusTarget = els.dialog.querySelector("button");
    if (focusTarget) focusTarget.focus({ preventScroll: true });
  }

  function closeDialog() {
    els.dialog.hidden = true;
    els.dialog.innerHTML = "";
    ui.dialogConfirm = null;
    ui.restoreActions = null;
    updateMapEnabled();
  }

  function confirmDialog(options) {
    var settings = options || {};
    ui.dialogConfirm = settings.onConfirm || null;
    openDialog(
      '<div class="dialog-card" role="dialog" aria-modal="true" aria-labelledby="dialog-title">' +
      '<h2 id="dialog-title">' + esc(settings.title || "Confirmar") + "</h2>" +
      "<p>" + esc(settings.message || "") + "</p>" +
      '<div class="dialog-actions">' +
      '<button class="btn is-ghost" type="button" data-action="dialog-cancel">' + esc(settings.cancelLabel || "Cancelar") + "</button>" +
      '<button class="btn ' + (settings.danger ? "is-danger" : "is-primary") + '" type="button" data-action="dialog-confirm">' +
      esc(settings.confirmLabel || "Confirmar") + "</button>" +
      "</div></div>"
    );
    var cancelButton = els.dialog.querySelector('[data-action="dialog-cancel"]');
    if (cancelButton) cancelButton.focus({ preventScroll: true });
  }

  function toast(message, duration) {
    clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.add("is-visible");
    toastTimer = setTimeout(function () {
      els.toast.classList.remove("is-visible");
    }, duration || 3400);
  }

  /* ------------------------------------------------------------------------
     Arrastrar y soltar / pegar fotos
     ------------------------------------------------------------------------ */
  function onDragOver(event) {
    if (ui.overlay !== "form" && ui.overlay !== "detail") return;
    var zone = event.target.closest && event.target.closest(".photo-zone");
    if (!zone) return;
    event.preventDefault();
    zone.classList.add("is-dragover");
  }

  function onDragLeave(event) {
    var zone = event.target.closest && event.target.closest(".photo-zone");
    if (zone) zone.classList.remove("is-dragover");
  }

  function onDrop(event) {
    var zone = event.target.closest && event.target.closest(".photo-zone");
    if (!zone) return;
    event.preventDefault();
    zone.classList.remove("is-dragover");
    var files = event.dataTransfer && event.dataTransfer.files;
    if (files && files.length) {
      ui.photoContext = ui.overlay === "form" ? "form" : "detail";
      ui.photoItemId = ui.sel;
      handlePhotoFiles(files);
    }
  }

  function onPaste(event) {
    if (ui.overlay !== "form" && ui.overlay !== "detail") return;
    var items = event.clipboardData && event.clipboardData.files;
    if (!items || !items.length) return;
    var files = Array.prototype.slice.call(items).filter(function (file) {
      return /^image\//i.test(file.type);
    });
    if (!files.length) return;
    event.preventDefault();
    ui.photoContext = ui.overlay === "form" ? "form" : "detail";
    ui.photoItemId = ui.sel;
    handlePhotoFiles(files);
  }

  /* ------------------------------------------------------------------------
     Arranque
     ------------------------------------------------------------------------ */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // Pequeña API para depuración desde la consola del navegador.
  window.MisAventurasRD = {
    getState: function () { return S; },
    getMap: function () { return map; },
    openForm: openForm,
    openDetail: openDetail,
    toast: toast
  };
})();
