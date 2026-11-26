// Deterministic 9-Invariant Voice-to-Slide Synchronization Quality Gate (0 LLM tokens!)
// Verifies: introLate, deadGaps, falseMath, bogusClauses, crossBlockClauses, overlaps, katexErrs, cueErrs, dupIds, cueOverlaps.
// Usage: node videolezioni/scripts/verify_sync.mjs [optional-lesson-id] [--verbose]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import katex from "katex";
import { parseHTML } from "linkedom";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(ROOT, "..");
const filterLesson = process.argv.slice(2).find((a) => !a.startsWith("--")) || null;
const verbose = process.argv.includes("--verbose");

const { document: gDoc, window: gWin, Node: gNode, Element: gEl } = parseHTML("<!doctype html><html><body></body></html>");
globalThis.window = gWin;
globalThis.document = gDoc;
globalThis.Node = gNode;
globalThis.Element = gEl;

const { LiveSyncEngine } = await import(pathToFileURL(path.join(ROOT, "js/live-sync.js")).href);
const { MATH_MACROS, registerMathMacros } = await import(pathToFileURL(path.join(ROOT, "js/math.js")).href);

const cfgPath = path.join(REPO_ROOT, "course.config.json");
if (fs.existsSync(cfgPath)) {
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  if (cfg.math_macros) registerMathMacros(cfg.math_macros);
}

function renderKatexIn(stage) {
  let katexErrs = 0;
  const walker = document.createTreeWalker(stage, 4);
  const nodes = [];
  let n;
  while ((n = walker.nextNode())) {
    if (n.parentElement && n.parentElement.closest("script, style, svg")) continue;
    if (/\\\[|\\\(|(?<!\\)\$/.test(n.nodeValue || "")) nodes.push(n);
  }
  for (const tn of nodes) {
    const raw = tn.nodeValue || "";
    const parts = raw.split(/(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$[^$\n]+?\$)/g);
    if (parts.length <= 1) continue;
    const frag = document.createDocumentFragment();
    for (const part of parts) {
      if (!part) continue;
      let tex = null, displayMode = false;
      if (part.startsWith("$$") && part.endsWith("$$")) { tex = part.slice(2, -2); displayMode = true; }
      else if (part.startsWith("\\[") && part.endsWith("\\]")) { tex = part.slice(2, -2); displayMode = true; }
      else if (part.startsWith("\\(") && part.endsWith("\\)")) { tex = part.slice(2, -2); displayMode = false; }
      else if (part.startsWith("$") && part.endsWith("$")) { tex = part.slice(1, -1); displayMode = false; }
      if (tex !== null) {
        const span = document.createElement("span");
        try {
          span.innerHTML = katex.renderToString(tex, { displayMode, macros: { ...MATH_MACROS }, throwOnError: true, trust: true, strict: false });
        } catch {
          katexErrs++;
          span.textContent = part;
        }
        while (span.firstChild) frag.appendChild(span.firstChild);
      } else {
        frag.appendChild(document.createTextNode(part));
      }
    }
    tn.parentNode.replaceChild(frag, tn);
  }
  return katexErrs;
}

function normWords(s) {
  return (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/).filter((w) => w.length >= 4).map((w) => w.slice(0, Math.min(w.length, 6)));
}

function wordsIn(subs, t0, t1) {
  const out = [];
  for (const seg of subs?.segments || []) {
    for (const w of seg.words || []) {
      if (w.end >= t0 - 0.05 && w.start <= t1 + 0.05) out.push(w.text);
    }
  }
  return out.join(" ");
}

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "lessons/manifest.json"), "utf8"));
const lessons = filterLesson
  ? manifest.lessons.filter((l) => l.id === filterLesson)
  : manifest.lessons.filter((l) => l.status === "ready");

const totals = { scenes: 0, introLate: 0, deadGaps: 0, falseMath: 0, bogusClauses: 0, crossBlockClauses: 0, goodClauses: 0, goodMathAtoms: 0, overlaps: 0, katexErrs: 0, cueErrs: 0, dupIds: 0, cueOverlaps: 0, wrapperHl: 0, hlHidden: 0, metaWarns: 0 };
const WRAPPER_SEL = ".grid-2, .grid-3, .split-visual, .metrics-row, .pill-strip, .props-grid, .proof-steps, .flow-chain, .formula-col, .visual-col";

for (const lesson of lessons) {
  const lDir = path.join(ROOT, "lessons", lesson.id);
  const lPath = path.join(lDir, "lesson.json");
  if (!fs.existsSync(lPath)) continue;
  const data = JSON.parse(fs.readFileSync(lPath, "utf8"));
  if (typeof lesson.scenes_count === "number" && lesson.scenes_count !== data.scenes.length) {
    totals.metaWarns++;
    if (verbose) console.log(`  [META_WARN] ${lesson.id}: manifest scenes_count=${lesson.scenes_count} != lesson.json (${data.scenes.length})`);
  }
  const lt = { introLate: 0, deadGaps: 0, falseMath: 0, bogusClauses: 0, crossBlockClauses: 0, goodClauses: 0, goodMathAtoms: 0, overlaps: 0 };

  for (const scene of data.scenes) {
    totals.scenes++;
    const subPath = path.join(lDir, "subtitles", `${scene.id}.json`);
    const subs = fs.existsSync(subPath) ? JSON.parse(fs.readFileSync(subPath, "utf8")) : { duration: scene.duration_sec || 40, segments: [] };

    const { document: doc } = parseHTML(`<!doctype html><html><body><article id="stage">${scene.slide_html}</article></body></html>`);
    globalThis.document = doc;
    const stage = doc.getElementById("stage");
    totals.katexErrs += renderKatexIn(stage);

    // Check duplicate element IDs inside the same scene (breaks querySelector / cue targeting)
    const seenIds = new Set();
    for (const el of stage.querySelectorAll("[id]")) {
      const id = el.getAttribute("id");
      if (!id) continue;
      if (seenIds.has(id)) {
        totals.dupIds++;
        if (verbose) console.log(`  [DUP_ID] ${lesson.id}/${scene.id}: duplicate id="${id}"`);
      } else {
        seenIds.add(id);
      }
    }

    const showAtByEl = new Map();
    for (const c of scene.cues || []) {
      const matched = stage.querySelectorAll(c.target);
      if (matched.length === 0) {
        totals.cueErrs++;
        if (verbose) console.log(`  [CUE_MISSING] ${lesson.id}/${scene.id} @ ${c.at}s: ${c.action} "${c.target}"`);
      } else if (c.action === "show") {
        matched.forEach((el) => {
          const prev = showAtByEl.get(el);
          if (prev === undefined || c.at < prev) showAtByEl.set(el, c.at);
        });
      } else if (c.action === "highlight") {
        matched.forEach((el) => {
          if (el.matches(WRAPPER_SEL)) {
            totals.wrapperHl++;
            if (verbose) console.log(`  [WRAPPER_HL] ${lesson.id}/${scene.id} @ ${c.at}s: highlight on layout wrapper "${c.target}" (${el.className})`);
          }
        });
      }
    }
    for (const c of scene.cues || []) {
      if (c.action !== "highlight") continue;
      for (const el of stage.querySelectorAll(c.target)) {
        let cur = el;
        let reqShow = 0;
        while (cur && cur !== stage) {
          if (cur.classList?.contains("cue-hidden")) {
            const sAt = showAtByEl.get(cur);
            if (typeof sAt === "number") reqShow = Math.max(reqShow, sAt);
          }
          cur = cur.parentElement;
        }
        if (reqShow > 0 && c.at < reqShow - 0.15) {
          totals.hlHidden++;
          if (verbose) console.log(`  [HL_HIDDEN] ${lesson.id}/${scene.id} @ ${c.at}s: "${c.target}" shown later at ${reqShow}s`);
        }
      }
    }

    // Check overlapping highlight cue windows on the same DOM target (mirrors player.js applyCuesAt)
    const hlCues = (scene.cues || []).filter((c) => c.action === "highlight").sort((a, b) => a.at - b.at);
    const hlByEl = new Map();
    for (let i = 0; i < hlCues.length; i++) {
      const cue = hlCues[i];
      const next = hlCues[i + 1];
      let endAt;
      if (typeof cue.duration === "number" && cue.duration > 0) {
        endAt = cue.at + cue.duration;
      } else if (next) {
        const gap = next.at - cue.at;
        endAt = gap > 1.2 ? cue.at + Math.min(4.2, gap - 0.08) : cue.at + 2.4;
      } else {
        endAt = cue.at + 4.2;
      }
      for (const el of stage.querySelectorAll(cue.target)) {
        if (!hlByEl.has(el)) hlByEl.set(el, []);
        hlByEl.get(el).push({ start: cue.at, end: endAt, target: cue.target });
      }
    }
    for (const wins of hlByEl.values()) {
      wins.sort((a, b) => a.start - b.start);
      for (let i = 1; i < wins.length; i++) {
        if (wins[i].start < wins[i - 1].end - 0.15) {
          totals.cueOverlaps++;
          if (verbose) {
            console.log(
              `  [CUE_OVERLAP] ${lesson.id}/${scene.id}: "${wins[i - 1].target}" [${wins[i - 1].start.toFixed(1)}..${wins[i - 1].end.toFixed(1)}s] overlaps "${wins[i].target}" [${wins[i].start.toFixed(1)}..${wins[i].end.toFixed(1)}s]`
            );
          }
        }
      }
    }

    const visAt0 = Array.from(stage.querySelectorAll(".box, .math-card, .proof-step, .svg-panel, .acad-table"))
      .filter((el) => !el.classList.contains("cue-hidden") && !el.closest(".cue-hidden")).length;
    const showCues = (scene.cues || []).filter((c) => c.action === "show").sort((a, b) => a.at - b.at);
    const firstShow = showCues.length ? showCues[0].at : 0;
    if (visAt0 === 0 && firstShow > 6.5) {
      lt.introLate++;
      if (verbose) console.log(`  [INTRO_LATE] ${lesson.id}/${scene.id}: blank title for ${firstShow.toFixed(1)}s`);
    }

    const engine = new LiveSyncEngine(stage, () => {});
    engine.prepareScene(scene, subs);

    const allWins = [];
    for (const a of engine.atoms) {
      const atxt = a.els.map((e) => e.textContent).join("").replace(/[\s\u200b]+/g, "");
      for (const w of a.windows) {
        allWins.push({ start: w.start, end: w.end, atxt });
        const spk = wordsIn(subs, w.start, w.end).toLowerCase();
        const spkTokens = spk.split(/[^a-z0-9àèéìòù]+/).filter(Boolean);
        const isDiPrep = a.keys.has("var:d_i") && spkTokens.includes("di") && !(/\bd\s+(?:con\s+)?i\b/.test(spk));
        const isWrongD = a.keys.has("var:D_l") && /\bd\s+(?:con\s+)?(?:uno|due|tre|k|tr|vl|ts|r)\b/.test(spk) && !/\bd\s+(?:con\s+)?l\b/.test(spk);
        if (isDiPrep || isWrongD) {
          lt.falseMath++;
          if (verbose) console.log(`  [FALSE_MATH] ${lesson.id}/${scene.id} @ ${w.start.toFixed(1)}s: atom="${atxt}" on "${spk}"`);
        } else {
          lt.goodMathAtoms++;
        }
      }
    }

    allWins.sort((a, b) => a.start - b.start);
    for (let i = 1; i < allWins.length; i++) {
      if (allWins[i].start < allWins[i - 1].end - 0.002) lt.overlaps++;
    }

    for (const c of engine.clauses) {
      const dur = c.end - c.start;
      const cWords = normWords(c.el.textContent || "");
      const sWords = new Set(normWords(wordsIn(subs, c.start - 0.5, c.end + 0.5)));
      const overlap = cWords.length ? cWords.filter((w) => sWords.has(w)).length / cWords.length : 1;
      if (dur > 18 || (cWords.length >= 3 && overlap < 0.22)) {
        lt.bogusClauses++;
        if (verbose) console.log(`  [BOGUS_CLAUSE] ${lesson.id}/${scene.id} [${c.start.toFixed(1)}..${c.end.toFixed(1)}s] ov=${(overlap * 100).toFixed(0)}%`);
      } else {
        lt.goodClauses++;
      }
    }

    let deadRun = 0, maxDeadRun = 0;
    const crossSeen = new Set();
    for (let t = Math.ceil(firstShow) + 1; t < (subs.duration || 30) - 2; t += 1) {
      for (const c of scene.cues || []) {
        const els = stage.querySelectorAll(c.target);
        if (c.action === "show") {
          const vis = t >= c.at && (typeof c.until !== "number" || t < c.until);
          els.forEach((e) => e.classList.toggle("cue-hidden", !vis));
        } else if (c.action === "highlight") {
          const d = typeof c.duration === "number" ? c.duration : 4;
          const on = t >= c.at && t <= c.at + d;
          els.forEach((e) => e.classList.toggle("cue-highlight", on));
        }
      }
      engine.update(t, false);
      const activeClause = stage.querySelector(".voice-active");
      if (activeClause && activeClause.closest(".spotlight-dim") && !crossSeen.has(activeClause)) {
        crossSeen.add(activeClause);
        lt.crossBlockClauses++;
        if (verbose) console.log(`  [CROSS_BLOCK_CLAUSE] ${lesson.id}/${scene.id} @ ${t}s`);
      }
      const alive = Boolean(stage.querySelector(".spotlight-active, .spotlight-group, .cue-highlight, .voice-active, .math-live-glow"));
      deadRun = alive ? 0 : deadRun + 1;
      if (deadRun > maxDeadRun) maxDeadRun = deadRun;
    }
    if (maxDeadRun >= 8) {
      lt.deadGaps++;
      if (verbose) console.log(`  [DEAD_STAGE] ${lesson.id}/${scene.id}: ${maxDeadRun}s consecutive`);
    }
  }

  for (const k of Object.keys(lt)) totals[k] += lt[k];
  console.log(
    `${lesson.id.padEnd(22)} | intro>6.5s=${String(lt.introLate).padStart(2)} | dead>=8s=${String(lt.deadGaps).padStart(2)} | falseMath=${String(lt.falseMath).padStart(3)} | bogusClause=${String(lt.bogusClauses).padStart(2)} | xBlock=${String(lt.crossBlockClauses).padStart(2)} | goodClause=${String(lt.goodClauses).padStart(3)} | goodMath=${String(lt.goodMathAtoms).padStart(3)} | ov=${lt.overlaps}`
  );
}

console.log(
  `\nTOTAL (${totals.scenes} sc): introLate=${totals.introLate} | deadGaps=${totals.deadGaps} | falseMath=${totals.falseMath} | bogusClauses=${totals.bogusClauses} | xBlock=${totals.crossBlockClauses} | goodClauses=${totals.goodClauses} | goodMath=${totals.goodMathAtoms} | ov=${totals.overlaps} | kErr=${totals.katexErrs} | cErr=${totals.cueErrs} | dupId=${totals.dupIds} | cOv=${totals.cueOverlaps} | wHl=${totals.wrapperHl} | hlHid=${totals.hlHidden}${totals.metaWarns ? ` | metaWarn=${totals.metaWarns}` : ""}`
);

const hardFails = totals.introLate + totals.deadGaps + totals.falseMath + totals.crossBlockClauses + totals.overlaps + totals.katexErrs + totals.cueErrs + totals.dupIds + totals.cueOverlaps + totals.wrapperHl + totals.hlHidden;
if (hardFails > 0) process.exit(1);
