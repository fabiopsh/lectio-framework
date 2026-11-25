// Central Course Config Loader — reads single source of truth `course.config.json`

export const DEFAULT_CONFIG = {
  slug: "lectio-course",
  title: "Il Mio Corso",
  subtitle: "Videolezioni Interattive",
  eyebrow: ["Corso Universitario", "Videolezioni Interattive"],
  language: "it",
  default_theme: "studio",
  tutor_avatar: { enabled: true, name: "Lia", spritesheet: "assets/lia-spritesheet.png", description: "" },
  author: { name: "", label_prefix: "Appunti di", github_username: "", avatar: "" },
  professor: { name: "", role: "Docente del corso", url: "", avatar: "" },
  github: { repo: "", pages_url: "", show_star_button: true, enable_issue_reporter: true },
  search: { suggested_queries: ["teorema", "algoritmo", "esempio", "formula"] },
  tts: { provider: "gemini", model: "gemini-3.8-flash-tts", voice_name: "Kore", edge_voice: "it-IT-ElsaNeural" },
  math_macros: {}
};

let cachedConfig = null;

export async function loadCourseConfig(assetRoot = ".") {
  if (cachedConfig) return cachedConfig;
  const root = (assetRoot || ".").replace(/\/+$/, "");
  const url = `${root}/course.config.json`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (res.ok) {
      const raw = await res.json();
      cachedConfig = {
        ...DEFAULT_CONFIG,
        ...raw,
        tutor_avatar: { ...DEFAULT_CONFIG.tutor_avatar, ...(raw.tutor_avatar || {}) },
        author: { ...DEFAULT_CONFIG.author, ...(raw.author || {}) },
        professor: { ...DEFAULT_CONFIG.professor, ...(raw.professor || {}) },
        github: { ...DEFAULT_CONFIG.github, ...(raw.github || {}) },
        search: { ...DEFAULT_CONFIG.search, ...(raw.search || {}) },
        tts: { ...DEFAULT_CONFIG.tts, ...(raw.tts || {}) },
        math_macros: { ...(raw.math_macros || {}) }
      };
      return cachedConfig;
    }
  } catch {
    // Fallback to defaults if config not present
  }
  cachedConfig = DEFAULT_CONFIG;
  return cachedConfig;
}
