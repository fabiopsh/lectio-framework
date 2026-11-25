// Shared Theme Switcher + Local Study Progress + Generic Parametric Mini SVG Art
// Default theme: "studio" (modern high-craft editorial light)

let courseNamespace = "lectio";

export function setCourseNamespace(slug) {
  if (slug && typeof slug === "string") {
    courseNamespace = slug.replace(/[^a-z0-9_-]+/gi, "_").toLowerCase();
  }
}

function themeKey() {
  return `${courseNamespace}_theme_v1`;
}

function progressKey() {
  return `${courseNamespace}_progress_v1`;
}

export const THEMES = [
  { id: "studio", label: "Studio",       desc: "Chiaro moderno, pulito ed editoriale",     swatches: ["#FFFFFF", "#141413", "#1D4ED8"], metaColor: "#F6F6F3" },
  { id: "carbon", label: "Carbon",       desc: "Scuro minimale in grafite pura",           swatches: ["#121215", "#F4F4F5", "#7AA2F7"], metaColor: "#09090B" },
  { id: "glass",  label: "Liquid Glass", desc: "Vetro satinato traslucido stile Apple",    swatches: ["#DCEBFC", "#0071E3", "#FFFFFF"], metaColor: "#E7EEF8" },
  { id: "arcade", label: "16-bit",       desc: "Retro gaming console & JRPG a pixel",      swatches: ["#161E3A", "#FFD447", "#4FD1FF"], metaColor: "#0D1122" }
];

const DEFAULT_THEME = "studio";

export function getSavedTheme(fallback = DEFAULT_THEME) {
  try {
    const saved = localStorage.getItem(themeKey());
    if (saved && THEMES.some((t) => t.id === saved)) return saved;
  } catch {}
  return THEMES.some((t) => t.id === fallback) ? fallback : DEFAULT_THEME;
}

export function applyTheme(themeId) {
  const themeObj = THEMES.find((t) => t.id === themeId) || THEMES[0];
  const valid = themeObj.id;
  document.documentElement.setAttribute("data-theme", valid);
  let metaTheme = document.querySelector('meta[name="theme-color"]');
  if (!metaTheme) {
    metaTheme = document.createElement("meta");
    metaTheme.name = "theme-color";
    document.head.appendChild(metaTheme);
  }
  metaTheme.content = themeObj.metaColor;
  try {
    localStorage.setItem(themeKey(), valid);
  } catch {}
  document.querySelectorAll(".theme-pill").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.theme === valid);
    btn.setAttribute("aria-pressed", String(btn.dataset.theme === valid));
  });
  return valid;
}

export function mountThemeSwitcher(container, defaultTheme = DEFAULT_THEME) {
  if (!container) return;
  const current = applyTheme(getSavedTheme(defaultTheme));
  container.innerHTML = "";
  container.classList.add("theme-switcher");
  container.setAttribute("role", "group");
  container.setAttribute("aria-label", "Selettore stile grafico");

  for (const t of THEMES) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `theme-pill ${t.id === current ? "active" : ""}`;
    btn.dataset.theme = t.id;
    btn.title = `${t.label} — ${t.desc}`;
    btn.setAttribute("aria-pressed", String(t.id === current));
    btn.innerHTML = `
      <span class="theme-swatch" style="background:${t.swatches[0]};border-color:${t.swatches[1]}">
        <i style="background:${t.swatches[1]}"></i>
      </span>
      <span class="theme-pill-label">${t.label}</span>
    `;
    btn.addEventListener("click", () => {
      if (container.classList.contains("player-theme-compact") && window.innerWidth <= 680) {
        const cur = document.documentElement.getAttribute("data-theme") || DEFAULT_THEME;
        const idx = THEMES.findIndex((x) => x.id === cur);
        const next = THEMES[(idx + 1) % THEMES.length];
        applyTheme(next.id);
        return;
      }
      applyTheme(t.id);
    });
    container.appendChild(btn);
  }
}

export function loadProgress() {
  try {
    const raw = localStorage.getItem(progressKey());
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        parsed.watched = parsed.watched || {};
        return parsed;
      }
    }
  } catch {}
  return { lastLessonId: null, lastSceneIdx: 0, lastUpdated: 0, watched: {} };
}

export function saveSceneProgress(lessonId, sceneIdx, markWatched = false) {
  const p = loadProgress();
  p.lastLessonId = lessonId;
  p.lastSceneIdx = sceneIdx;
  p.lastUpdated = Date.now();
  if (!Array.isArray(p.watched[lessonId])) p.watched[lessonId] = [];
  if (markWatched && !p.watched[lessonId].includes(sceneIdx)) {
    p.watched[lessonId].push(sceneIdx);
  }
  try {
    localStorage.setItem(progressKey(), JSON.stringify(p));
  } catch {}
  return p;
}

// 10 generic course-agnostic mini thematic SVG icons (selectable via lesson.icon or cycled by chapter index)
const GENERIC_ICONS = {
  roadmap: `<svg viewBox="0 0 80 42" class="mini-art"><path d="M10 30 Q26 12 40 21 T70 12" fill="none" stroke="var(--blue)" stroke-width="2"/><circle cx="10" cy="30" r="3" fill="var(--blue)"/><circle cx="40" cy="21" r="3" fill="var(--orange)"/><circle cx="70" cy="12" r="3" fill="var(--green)"/></svg>`,
  formula: `<svg viewBox="0 0 80 42" class="mini-art"><text x="12" y="28" fill="var(--blue)" font-family="var(--font-serif)" font-size="16" font-style="italic">f(x)</text><path d="M46 31 L68 11" stroke="var(--orange)" stroke-width="2"/><circle cx="68" cy="11" r="2.8" fill="var(--red)"/></svg>`,
  flow:    `<svg viewBox="0 0 80 42" class="mini-art"><rect x="6" y="13" width="18" height="16" rx="3" fill="none" stroke="var(--muted)" stroke-width="1.4"/><rect x="31" y="11" width="18" height="20" rx="3" fill="var(--blue-soft)" stroke="var(--blue)" stroke-width="1.8"/><rect x="56" y="13" width="18" height="16" rx="3" fill="none" stroke="var(--green)" stroke-width="1.4" stroke-dasharray="3 2"/><line x1="24" y1="21" x2="31" y2="21" stroke="var(--ink-soft)" stroke-width="1.4"/><line x1="49" y1="21" x2="56" y2="21" stroke="var(--ink-soft)" stroke-width="1.4"/></svg>`,
  curve:   `<svg viewBox="0 0 80 42" class="mini-art"><path d="M8 33 Q24 8 40 20 T72 10" fill="none" stroke="var(--blue)" stroke-width="2"/><path d="M8 29 Q28 24 46 28 T72 16" fill="none" stroke="var(--green)" stroke-width="1.6" stroke-dasharray="3 2"/></svg>`,
  bars:    `<svg viewBox="0 0 80 42" class="mini-art"><rect x="12" y="22" width="10" height="14" rx="2" fill="var(--blue-soft)" stroke="var(--blue)" stroke-width="1.4"/><rect x="28" y="14" width="10" height="22" rx="2" fill="var(--blue-soft)" stroke="var(--blue)" stroke-width="1.4"/><rect x="44" y="8" width="10" height="28" rx="2" fill="var(--blue)"/><rect x="60" y="18" width="10" height="18" rx="2" fill="var(--blue-soft)" stroke="var(--green)" stroke-width="1.4"/></svg>`,
  graph:   `<svg viewBox="0 0 80 42" class="mini-art"><line x1="18" y1="14" x2="40" y2="10" stroke="var(--muted)" stroke-width="1.4"/><line x1="18" y1="14" x2="36" y2="30" stroke="var(--muted)" stroke-width="1.4"/><line x1="40" y1="10" x2="62" y2="18" stroke="var(--blue)" stroke-width="1.6"/><line x1="36" y1="30" x2="62" y2="18" stroke="var(--blue)" stroke-width="1.6"/><circle cx="18" cy="14" r="3.5" fill="var(--blue)"/><circle cx="40" cy="10" r="3.5" fill="var(--orange)"/><circle cx="36" cy="30" r="3.5" fill="var(--green)"/><circle cx="62" cy="18" r="3.5" fill="var(--red)"/></svg>`,
  matrix:  `<svg viewBox="0 0 80 42" class="mini-art"><rect x="16" y="7" width="14" height="12" rx="2" fill="var(--blue-soft)" stroke="var(--blue)" stroke-width="1.3"/><rect x="33" y="7" width="14" height="12" rx="2" fill="none" stroke="var(--muted)" stroke-width="1.2"/><rect x="50" y="7" width="14" height="12" rx="2" fill="none" stroke="var(--muted)" stroke-width="1.2"/><rect x="16" y="23" width="14" height="12" rx="2" fill="none" stroke="var(--muted)" stroke-width="1.2"/><rect x="33" y="23" width="14" height="12" rx="2" fill="var(--blue)"/><rect x="50" y="23" width="14" height="12" rx="2" fill="var(--blue-soft)" stroke="var(--green)" stroke-width="1.3"/></svg>`,
  tree:    `<svg viewBox="0 0 80 42" class="mini-art"><line x1="40" y1="10" x2="22" y2="28" stroke="var(--ink-soft)" stroke-width="1.4"/><line x1="40" y1="10" x2="58" y2="28" stroke="var(--ink-soft)" stroke-width="1.4"/><circle cx="40" cy="10" r="4" fill="var(--blue)"/><circle cx="22" cy="28" r="4" fill="var(--green)"/><circle cx="58" cy="28" r="4" fill="var(--orange)"/></svg>`,
  layers:  `<svg viewBox="0 0 80 42" class="mini-art"><rect x="14" y="7" width="52" height="7" rx="3" fill="var(--blue)"/><rect x="18" y="18" width="44" height="7" rx="3" fill="var(--blue-soft)" stroke="var(--blue)" stroke-width="1.4"/><rect x="22" y="29" width="36" height="7" rx="3" fill="none" stroke="var(--green)" stroke-width="1.4"/></svg>`,
  code:    `<svg viewBox="0 0 80 42" class="mini-art"><path d="M26 13 L15 21 L26 29" fill="none" stroke="var(--blue)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M54 13 L65 21 L54 29" fill="none" stroke="var(--blue)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><line x1="44" y1="11" x2="36" y2="31" stroke="var(--orange)" stroke-width="2" stroke-linecap="round"/></svg>`
};

const ICON_ORDER = Object.keys(GENERIC_ICONS);

export function chapterMiniSvg(chapter, iconName = null) {
  if (iconName && GENERIC_ICONS[iconName]) return GENERIC_ICONS[iconName];
  const idx = Math.abs(Number(chapter) || 0) % ICON_ORDER.length;
  return GENERIC_ICONS[ICON_ORDER[idx]];
}
