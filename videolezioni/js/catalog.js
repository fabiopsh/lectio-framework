// Dual-view Catalog Hub (Interactive Course Map + Editorial Bento Grid)
// Features: live Theme Switcher, Author/Prof credits + GitHub Star count, Resume Hero, study hours progress, instant search.

import { mountThemeSwitcher, loadProgress, chapterMiniSvg, setCourseNamespace } from "./theme.js";
import { initGlobalSearch } from "./search.js";
import { loadCourseConfig } from "./config.js";

const VIEW_KEY = "lectio_catalog_view_v1";
const STARS_CACHE_KEY = "lectio_gh_stars_v1";
const USE_CLEAN_URLS = document.documentElement.dataset.cleanUrls === "true";

function escapeHtml(s) {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function lessonUrl(id, sceneIdx = 0) {
  const safeId = encodeURIComponent(id);
  if (USE_CLEAN_URLS) {
    return sceneIdx > 0 ? `${safeId}/?scena=${sceneIdx + 1}` : `${safeId}/`;
  }
  return sceneIdx > 0 ? `lesson.html?id=${safeId}&scena=${sceneIdx + 1}` : `lesson.html?id=${safeId}`;
}

const ICON_CHEVRON = `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>`;
const ICON_CHECK = `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>`;
const ICON_LINK = `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>`;

function getSavedView() {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (v === "map" || v === "bento") return v;
  } catch {}
  return "map";
}

function fmtHours(totalMin) {
  const mins = Math.max(0, Math.round(totalMin || 0));
  if (mins === 0) return "0 min";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m} min`;
}

async function loadGitHubStars(badgeEl, repoSlug) {
  if (!badgeEl || !repoSlug) return;
  const cacheKey = `${STARS_CACHE_KEY}_${repoSlug}`;
  try {
    const cached = sessionStorage.getItem(cacheKey);
    if (cached !== null) {
      badgeEl.textContent = cached;
      badgeEl.hidden = false;
      return;
    }
  } catch {}

  try {
    const res = await fetch(`https://api.github.com/repos/${repoSlug}`, {
      headers: { Accept: "application/vnd.github+json" }
    });
    if (!res.ok) return;
    const data = await res.json();
    if (typeof data.stargazers_count === "number") {
      const val = String(data.stargazers_count);
      badgeEl.textContent = val;
      badgeEl.hidden = false;
      try { sessionStorage.setItem(cacheKey, val); } catch {}
    }
  } catch {
    // Offline or rate-limited
  }
}

function mountHeroLia(cardEl, spriteEl) {
  if (!spriteEl) return;
  let hovered = false;
  let welcomeUntil = performance.now() + 900;
  let nextBlink = performance.now() + 2800 + Math.random() * 2000;
  let blinkEnd = 0;

  const setFrame = (idx) => {
    spriteEl.style.backgroundPosition = `${idx * 20}% 0%`;
  };

  if (cardEl) {
    cardEl.addEventListener("pointerenter", () => {
      hovered = true;
      setFrame(5); // Warm happy smile on hover
    });
    cardEl.addEventListener("pointerleave", () => {
      hovered = false;
      setFrame(0);
    });
  }

  setFrame(5);
  setInterval(() => {
    if (document.hidden) return;
    const now = performance.now();
    if (hovered || now < welcomeUntil) {
      setFrame(5);
      return;
    }
    if (now >= nextBlink && blinkEnd === 0) {
      blinkEnd = now + 135;
      nextBlink = now + 3200 + Math.random() * 2600;
    }
    if (now < blinkEnd) {
      setFrame(1);
    } else {
      blinkEnd = 0;
      setFrame(0);
    }
  }, 85);
}

async function initCatalog() {
  const cfg = await loadCourseConfig(".");
  setCourseNamespace(cfg.slug);
  mountThemeSwitcher(document.getElementById("catalog-theme-switcher"), cfg.default_theme);

  // Hydrate hero metadata dynamically from course.config.json
  document.title = `${cfg.title} — ${cfg.subtitle || "Videolezioni Interattive"}`;
  const titleEl = document.getElementById("hero-title");
  if (titleEl) titleEl.textContent = cfg.title;

  const eyebrowEl = document.getElementById("hero-eyebrow");
  if (eyebrowEl && Array.isArray(cfg.eyebrow) && cfg.eyebrow.length > 0) {
    eyebrowEl.innerHTML = cfg.eyebrow
      .map((part) => `<span>${escapeHtml(part)}</span>`)
      .join(`<span class="hero-sep" aria-hidden="true">/</span>`);
  }

  const creditsRow = document.getElementById("hero-credits-row");
  const repoSlug = (cfg.github?.repo || "").trim();
  const repoUrl = repoSlug ? `https://github.com/${repoSlug}` : "";
  if (creditsRow && (cfg.author?.name || repoUrl)) {
    const parts = [];
    if (cfg.author?.name) {
      const avatarImg = cfg.author.avatar
        ? `<img class="credit-avatar" src="${escapeHtml(cfg.author.avatar)}" alt="${escapeHtml(cfg.author.name)}" width="40" height="40" />`
        : "";
      const ghSub = cfg.author.github_username
        ? `<span class="credit-sub"><svg class="credit-gh-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C6.48 2 2 6.58 2 12.26c0 4.54 2.87 8.39 6.84 9.75.5.09.68-.22.68-.49 0-.24-.01-1.05-.01-1.9-2.78.62-3.37-1.22-3.37-1.22-.46-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.63.07-.63 1 .07 1.53 1.05 1.53 1.05.9 1.57 2.35 1.12 2.92.85.09-.66.35-1.12.64-1.38-2.22-.26-4.56-1.14-4.56-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.27 2.75 1.05A9.36 9.36 0 0 1 12 6.84c.85 0 1.71.12 2.51.35 1.91-1.32 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.93-2.34 4.8-4.57 5.05.36.32.68.94.68 1.9 0 1.37-.01 2.48-.01 2.82 0 .27.18.59.69.49A10.26 10.26 0 0 0 22 12.26C22 6.58 17.52 2 12 2z"/></svg><span>${escapeHtml(cfg.author.github_username)}</span></span>`
        : "";
      const prefix = cfg.author.label_prefix ? `${escapeHtml(cfg.author.label_prefix)} ` : "";
      const tag = repoUrl ? "a" : "div";
      const attrs = repoUrl ? `href="${escapeHtml(repoUrl)}" target="_blank" rel="noopener noreferrer"` : "";
      parts.push(`<${tag} class="credit-person" ${attrs}>${avatarImg}<span class="credit-text"><span class="credit-name credit-name-author">${prefix}${escapeHtml(cfg.author.name)}</span>${ghSub}</span></${tag}>`);
    }
    if (repoUrl && cfg.github?.show_star_button !== false) {
      parts.push(`<a class="github-star-pill" href="${escapeHtml(repoUrl)}" target="_blank" rel="noopener noreferrer" title="Apri la repository su GitHub"><svg class="star-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg><span>Lascia una stella su GitHub</span><span id="github-stars-count" class="star-count-badge" hidden></span></a>`);
    }
    if (parts.length > 0) {
      creditsRow.innerHTML = parts.join("");
      creditsRow.hidden = false;
      if (repoSlug) loadGitHubStars(document.getElementById("github-stars-count"), repoSlug);
    }
  }

  const profRow = document.getElementById("hero-prof-row");
  if (profRow && cfg.professor?.name) {
    const profAvatar = cfg.professor.avatar
      ? `<img class="credit-avatar" src="${escapeHtml(cfg.professor.avatar)}" alt="${escapeHtml(cfg.professor.name)}" width="38" height="38" />`
      : "";
    const tag = cfg.professor.url ? "a" : "div";
    const attrs = cfg.professor.url ? `href="${escapeHtml(cfg.professor.url)}" target="_blank" rel="noopener noreferrer"` : "";
    profRow.innerHTML = `<${tag} class="credit-person credit-person-prof" ${attrs}>${profAvatar}<span class="credit-text"><span class="credit-name">${escapeHtml(cfg.professor.name)}</span><span class="credit-sub">${escapeHtml(cfg.professor.role || "Docente del corso")}</span></span></${tag}>`;
    profRow.hidden = false;
  }

  initGlobalSearch({
    assetRoot: ".",
    useCleanUrls: USE_CLEAN_URLS,
    triggerEls: [document.getElementById("btn-global-search-home")],
    suggestedQueries: cfg.search?.suggested_queries
  });

  const resumeCardEl = document.getElementById("resume-card");
  const heroLiaStage = document.getElementById("hero-lia-stage");
  const heroLiaSprite = document.getElementById("hero-lia-sprite");
  if (cfg.tutor_avatar?.enabled !== false) {
    if (heroLiaSprite) {
      const spriteRel = String(cfg.tutor_avatar?.spritesheet || "assets/lia-spritesheet.png").replace(/^\/+/, "");
      heroLiaSprite.style.backgroundImage = `url("${spriteRel}")`;
    }
    mountHeroLia(resumeCardEl, heroLiaSprite);
  } else if (heroLiaStage && resumeCardEl) {
    heroLiaStage.remove();
    resumeCardEl.classList.remove("resume-card-with-lia");
  }

  const root = document.getElementById("catalog-content");
  const statHours = document.getElementById("stat-hours");
  const statCompletedHours = document.getElementById("stat-completed-hours");
  const statCompletedPct = document.getElementById("stat-completed-pct");
  const studyProgressLabel = document.getElementById("study-progress-label");
  const studyProgressFill = document.getElementById("study-progress-fill");
  const resumeCard = document.getElementById("resume-card");
  const resumeKicker = document.getElementById("resume-kicker");
  const resumeTitle = document.getElementById("resume-title");
  const resumeMeta = document.getElementById("resume-meta");
  const resumeCta = document.getElementById("resume-cta");
  const searchInput = document.getElementById("catalog-search");
  const viewButtons = Array.from(document.querySelectorAll(".view-btn"));

  let manifest;
  try {
    const res = await fetch("lessons/manifest.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    manifest = await res.json();
  } catch (err) {
    root.innerHTML = `<div class="box box-warn"><div class="box-label">Errore di caricamento</div><p>Impossibile leggere <code>lessons/manifest.json</code>. Avvia l'app con <code>python videolezioni/scripts/serve.py</code>.</p></div>`;
    return;
  }

  const progress = loadProgress();
  const readyLessons = manifest.lessons.filter((l) => l.status === "ready");

  // Compute total hours & completed hours (weighted by watched scenes ratio per chapter)
  const totalMins = readyLessons.reduce(
    (acc, l) => acc + (l.duration_min || l.estimated_minutes || 0),
    0
  );
  const completedMins = readyLessons.reduce((acc, l) => {
    const arr = progress.watched?.[l.id];
    const totalSc = l.scenes_count || 0;
    const dur = l.duration_min || l.estimated_minutes || 0;
    if (!Array.isArray(arr) || !totalSc || !dur) return acc;
    const ratio = Math.min(1, arr.length / totalSc);
    return acc + dur * ratio;
  }, 0);
  const completedPct = totalMins > 0 ? Math.min(100, Math.round((completedMins / totalMins) * 100)) : 0;

  if (statHours) statHours.textContent = fmtHours(totalMins);
  if (statCompletedHours) statCompletedHours.textContent = fmtHours(completedMins);
  if (statCompletedPct) statCompletedPct.textContent = `${completedPct}%`;
  if (studyProgressLabel) studyProgressLabel.textContent = `${fmtHours(completedMins)} / ${fmtHours(totalMins)}`;
  if (studyProgressFill) studyProgressFill.style.width = `${completedPct}%`;

  // Configure Resume Hero Card
  const lastLesson = progress.lastLessonId
    ? readyLessons.find((l) => l.id === progress.lastLessonId)
    : null;
  const featured = lastLesson || readyLessons[0] || manifest.lessons[0];
  if (featured) {
    const isResuming = Boolean(lastLesson);
    const sceneIdx = isResuming ? (progress.lastSceneIdx || 0) : 0;
    const chapNum = String(featured.chapter).padStart(2, "0");
    const dur = featured.duration_min || featured.estimated_minutes || 10;
    resumeCard.href = lessonUrl(featured.id, sceneIdx);
    resumeKicker.textContent = isResuming ? `Riprendi · Cap. ${chapNum}` : `Inizia · Cap. ${chapNum}`;
    resumeTitle.textContent = featured.title;
    resumeMeta.textContent = isResuming
      ? `Scena ${sceneIdx + 1} di ${featured.scenes_count || "?"} · ~${dur} min`
      : `~${dur} min · Audio e formule sincronizzate`;
    resumeCta.innerHTML = `<span>${isResuming ? "Riprendi da qui" : "Avvia lezione"}</span>${ICON_CHEVRON}`;
  }

  let activeView = getSavedView();
  let query = "";

  viewButtons.forEach((b) => {
    const isAct = b.dataset.view === activeView;
    b.classList.toggle("active", isAct);
    b.setAttribute("aria-selected", String(isAct));
  });

  function matchesSearch(lesson, part) {
    if (!query) return true;
    const hay = `${lesson.chapter} ${lesson.id} ${lesson.title} ${lesson.summary} ${part.title}`.toLowerCase();
    return hay.includes(query);
  }

  function chapterProgressPct(lesson) {
    const arr = progress.watched?.[lesson.id];
    if (!Array.isArray(arr) || !lesson.scenes_count) return 0;
    return Math.min(100, Math.round((arr.length / lesson.scenes_count) * 100));
  }

  function renderMap() {
    const wrap = document.createElement("div");
    wrap.className = "roadmap-wrap";
    let renderedAny = false;

    for (const part of manifest.parts) {
      const partLessons = manifest.lessons.filter((l) => l.part === part.id && matchesSearch(l, part));
      if (partLessons.length === 0) continue;
      renderedAny = true;

      const partMins = partLessons.reduce((acc, l) => acc + (l.duration_min || l.estimated_minutes || 0), 0);
      const stage = document.createElement("section");
      stage.className = "roadmap-stage";
      stage.innerHTML = `
        <div class="roadmap-stage-head">
          <div>
            <div class="roadmap-part-pill">${part.label}</div>
            <h2 class="roadmap-part-title">${part.title}</h2>
          </div>
          <span class="roadmap-part-count">${fmtHours(partMins)}</span>
        </div>
        <div class="roadmap-track"></div>
      `;

      const track = stage.querySelector(".roadmap-track");
      partLessons.forEach((lesson, idx) => {
        const chapLabel = `Cap. ${String(lesson.chapter).padStart(2, "0")}`;
        const dur = lesson.duration_min || lesson.estimated_minutes || 10;
        const pct = chapterProgressPct(lesson);

        const nodeWrap = document.createElement("div");
        nodeWrap.className = "map-node-wrap";

        if (idx > 0) {
          const conn = document.createElement("span");
          conn.className = "map-connector active";
          conn.setAttribute("aria-hidden", "true");
          conn.innerHTML = ICON_LINK;
          nodeWrap.appendChild(conn);
        }

        const node = document.createElement("a");
        node.className = `map-node ${lesson.status === "ready" ? "ready" : "planned"}`;
        node.href = lessonUrl(lesson.id);

        const doneBadge = pct === 100
          ? `<span class="status-pill-ready" style="margin-left:6px;">${ICON_CHECK} Completato</span>`
          : "";

        node.innerHTML = `
          <div>
            <div class="map-node-top">
              <div>
                <span class="chap-num">${chapLabel}</span>${doneBadge}
              </div>
              <div class="map-node-art">${chapterMiniSvg(lesson.chapter, lesson.icon)}</div>
            </div>
            <h3 style="margin-top:8px;">${lesson.title}</h3>
            <p style="margin-top:4px;">${lesson.summary}</p>
          </div>
          <div>
            ${pct > 0 ? `<div class="node-progress-bar"><div class="node-progress-fill" style="width:${pct}%"></div></div>` : ""}
            <div class="map-node-foot">
              <span>~${dur} min</span>
              <span class="lesson-cta"><span>${pct > 0 && pct < 100 ? `${pct}%` : "Apri"}</span>${ICON_CHEVRON}</span>
            </div>
          </div>
        `;
        nodeWrap.appendChild(node);
        track.appendChild(nodeWrap);
      });

      wrap.appendChild(stage);
    }

    if (!renderedAny) {
      root.innerHTML = `<div class="empty-state">Nessun capitolo trovato per «${escapeHtml(query)}». Prova con un altro termine.</div>`;
    } else {
      root.innerHTML = "";
      root.appendChild(wrap);
    }
  }

  function renderBento() {
    root.innerHTML = "";
    let renderedAny = false;

    for (const part of manifest.parts) {
      const partLessons = manifest.lessons.filter((l) => l.part === part.id && matchesSearch(l, part));
      if (partLessons.length === 0) continue;
      renderedAny = true;

      const partMins = partLessons.reduce((acc, l) => acc + (l.duration_min || l.estimated_minutes || 0), 0);
      const sec = document.createElement("section");
      sec.className = "part-section";
      sec.innerHTML = `
        <div class="part-header">
          <span class="part-label">${part.label}</span>
          <h2 class="part-title">${part.title}</h2>
          <span class="roadmap-part-count" style="margin-left:auto;">${fmtHours(partMins)}</span>
        </div>
        <div class="bento-grid"></div>
      `;
      const grid = sec.querySelector(".bento-grid");

      for (const lesson of partLessons) {
        const chapLabel = `Cap. ${String(lesson.chapter).padStart(2, "0")}`;
        const dur = lesson.duration_min || lesson.estimated_minutes || 10;
        const pct = chapterProgressPct(lesson);

        const card = document.createElement("a");
        card.className = `bento-card ${lesson.status === "ready" ? "ready" : "planned"}`;
        card.href = lessonUrl(lesson.id);

        const doneBadge = pct === 100
          ? `<div style="margin-top:6px;"><span class="status-pill-ready">${ICON_CHECK} Completato</span></div>`
          : "";

        card.innerHTML = `
          <div>
            <div class="bento-visual">
              <div>
                <div class="chap-num">${chapLabel}</div>
                ${doneBadge}
              </div>
              ${chapterMiniSvg(lesson.chapter, lesson.icon)}
            </div>
            <div class="bento-body">
              <h3>${lesson.title}</h3>
              <p>${lesson.summary}</p>
            </div>
          </div>
          <div>
            ${pct > 0 ? `<div class="node-progress-bar" style="margin:0 18px 4px;"><div class="node-progress-fill" style="width:${pct}%"></div></div>` : ""}
            <div class="bento-foot">
              <span>~${dur} min</span>
              <span class="lesson-cta"><span>${pct > 0 && pct < 100 ? `${pct}%` : "Avvia"}</span>${ICON_CHEVRON}</span>
            </div>
          </div>
        `;
        grid.appendChild(card);
      }
      root.appendChild(sec);
    }

    if (!renderedAny) {
      root.innerHTML = `<div class="empty-state">Nessun capitolo trovato per «${escapeHtml(query)}». Prova con un altro termine.</div>`;
    }
  }

  function render() {
    if (activeView === "map") renderMap();
    else renderBento();
  }

  for (const btn of viewButtons) {
    btn.addEventListener("click", () => {
      activeView = btn.dataset.view;
      viewButtons.forEach((b) => {
        b.classList.toggle("active", b === btn);
        b.setAttribute("aria-selected", String(b === btn));
      });
      try { localStorage.setItem(VIEW_KEY, activeView); } catch {}
      render();
    });
  }

  if (searchInput) {
    searchInput.addEventListener("input", () => {
      query = searchInput.value.trim().toLowerCase();
      render();
    });
  }

  render();
}

initCatalog();
