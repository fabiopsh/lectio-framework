// Deterministic, Zero-Deletion, MMS_FA-Aligned Sync Polisher (0 LLM tokens!)
// Pulls blank intro stages to <= 4.5s, extends highlight cues to spoken durations,
// and injects granular highlights on <li>, <tr>, .metric, and .grid sibling cards.
// Usage: node videolezioni/scripts/polish_sync.mjs [optional-lesson-id]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseHTML } from "linkedom";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "lessons");
const filterLesson = process.argv.slice(2).find((a) => !a.startsWith("--")) || null;
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));

const STOP = new Set([
  "di","a","da","in","con","su","per","tra","fra","il","lo","la","i","gli","le",
  "un","uno","una","e","ed","o","od","ma","che","chi","cui","se","al","allo","alla",
  "ai","agli","alle","del","dello","della","dei","degli","delle","nel","nello","nella",
  "nei","negli","nelle","sul","sullo","sulla","sui","sugli","sulle","dal","dallo","dalla",
  "si","ci","vi","ne","non","piu","meno","come","dove","quando","anche","solo",
  "sono","era","sia","puo","ha","hanno","fare","fa","suo","sua","suoi","loro",
  "questo","questa","questi","queste","quello","quella","tutti","tutte","ogni",
  "the","and","for","with","from","that","this","into","are","was","were","have","has"
]);

function stripAccents(s) {
  return (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normTok(raw) {
  let t = stripAccents(raw).replace(/[^a-z0-9]+/g, "");
  if (!t) return "";
  if (/^\d+$/.test(t)) return t;
  if (t.length <= 2 || STOP.has(t)) return "";
  if (t.length >= 6) {
    t = t.replace(/(azioni|azione|zioni|zione|menti|mento|abili|abile|ibili|ibile|ando|endo|iamo|ate|ete|ite|are|ere|ire|ita|iche|ichi|che|chi)$/, "");
  }
  if (t.length >= 4 && !/^\d+$/.test(t)) t = t.replace(/[aeiou]$/, "");
  return t;
}

function extractToks(text) {
  const cleaned = (text || "")
    .replace(/\\(?:text|mathrm|mathbf|operatorname|mathcal|mathbb)\{([^}]*)\}/g, " $1 ")
    .replace(/\\(?:lambda|eta|theta|sigma|alpha|beta|gamma|delta|epsilon|xi|phi|mu|rho|tau|pi|omega)/gi, (m) => " " + m.slice(1) + " ")
    .replace(/\\(?:sum|prod|int|sqrt|min|max|arg|log|ln|exp|sin|cos|tanh|frac|left|right|big|Big|quad|qquad|dots|cdots|ldots|cdot|times|to|rightarrow|leftrightarrow|le|ge|neq|approx|sim|in|subset|setminus|cup|cap|boxed|htmlId|underbrace|bar|hat|tilde|norm|abs|Var|Bias|Cov|Remp|E|R|x|w)/g, " ")
    .replace(/[{}\\^_$()[\]|,.;:!?«»"—–\-/·→←↔=+×*]/g, " ");
  const out = new Set();
  for (const w of cleaned.split(/\s+/)) {
    const nt = normTok(w);
    if (nt) out.add(nt);
    const rawClean = w.replace(/[^A-Za-z0-9]/g, "");
    if (/^[A-Z]{2,6}$/.test(rawClean)) out.add(rawClean.toLowerCase());
  }
  return out;
}

function injectIdsIntoHtml(rawHtml, insertions) {
  if (!insertions.length) return rawHtml;
  const byTag = new Map();
  for (const ins of insertions) {
    const t = ins.tagName.toLowerCase();
    if (!byTag.has(t)) byTag.set(t, new Map());
    byTag.get(t).set(ins.occurrenceIndex, ins.newId);
  }
  let html = rawHtml;
  for (const [tag, map] of byTag.entries()) {
    let idx = -1;
    const rx = new RegExp(`<${tag}(?![a-z0-9-])(\\s[^>]*?)?>`, "gi");
    html = html.replace(rx, (full, attrs) => {
      idx++;
      const newId = map.get(idx);
      if (!newId || /\bid\s*=/i.test(attrs || "")) return full;
      return `<${tag} id="${newId}"${attrs || ""}>`;
    });
  }
  return html;
}

const r2 = (x) => Math.round(x * 100) / 100;

function alignMonotonicItems(itemTokSets, segsInWin, winStart, winEnd) {
  const K = itemTokSets.length;
  const M = segsInWin.length;
  if (K < 2 || M < K) return null;

  const S = Array.from({ length: K }, (_, k) => {
    const it = itemTokSets[k];
    return Array.from({ length: M }, (_, m) => {
      if (it.size === 0) return 0;
      let hits = 0;
      for (const tok of it) if (segsInWin[m].toks.has(tok)) hits++;
      let hitsNext = 0;
      if (m + 1 < M) {
        for (const tok of it) if (segsInWin[m + 1].toks.has(tok)) hitsNext++;
      }
      const bestHits = Math.max(hits, Math.min(it.size, hits + hitsNext * 0.45));
      return bestHits / Math.max(2, Math.min(it.size, 8));
    });
  });

  const dp = Array.from({ length: K }, () => Array(M).fill(-1e9));
  const parent = Array.from({ length: K }, () => Array(M).fill(-1));
  for (let m = 0; m < M; m++) dp[0][m] = S[0][m] + (m <= 2 ? 0.08 : 0);
  for (let k = 1; k < K; k++) {
    for (let m = k; m < M; m++) {
      let bestPrev = -1e9, bestP = -1;
      for (let p = k - 1; p < m; p++) {
        if (dp[k - 1][p] > bestPrev) { bestPrev = dp[k - 1][p]; bestP = p; }
      }
      dp[k][m] = bestPrev + S[k][m];
      parent[k][m] = bestP;
    }
  }

  let bestEnd = -1e9, lastM = -1;
  for (let m = K - 1; m < M; m++) {
    if (dp[K - 1][m] > bestEnd) { bestEnd = dp[K - 1][m]; lastM = m; }
  }
  if (lastM === -1) return null;

  const chosen = Array(K).fill(0);
  let cur = lastM;
  for (let k = K - 1; k >= 0; k--) { chosen[k] = cur; cur = parent[k][cur]; }

  let matchedCount = 0;
  for (let k = 0; k < K; k++) if (S[k][chosen[k]] >= 0.16) matchedCount++;
  if (matchedCount < Math.max(2, Math.ceil(K * 0.6))) return null;

  const out = [];
  for (let k = 0; k < K; k++) {
    const startT = Math.max(winStart + 0.05, segsInWin[chosen[k]].start - 0.05);
    const endT = k + 1 < K
      ? Math.max(startT + 1.2, segsInWin[chosen[k + 1]].start - 0.15)
      : Math.max(startT + 1.5, Math.min(winEnd - 0.15, segsInWin[M - 1].end + 0.2));
    if (endT - startT < 1.0) return null;
    out.push({ start: r2(startT), dur: r2(endT - startT) });
  }
  return out;
}

const lessons = filterLesson
  ? manifest.lessons.filter((l) => l.id === filterLesson)
  : manifest.lessons.filter((l) => l.status === "ready");

const stats = { chapters: 0, introsPulled: 0, hlExtended: 0, granularAdded: 0, blockHlAdded: 0, recapLiHlAdded: 0 };

for (const lesson of lessons) {
  const lPath = path.join(ROOT, lesson.id, "lesson.json");
  if (!fs.existsSync(lPath)) continue;
  stats.chapters++;
  const data = JSON.parse(fs.readFileSync(lPath, "utf8"));

  for (let sIdx = 0; sIdx < data.scenes.length; sIdx++) {
    const scene = data.scenes[sIdx];
    const subPath = path.join(ROOT, lesson.id, "subtitles", `${scene.id}.json`);
    const subs = fs.existsSync(subPath) ? JSON.parse(fs.readFileSync(subPath, "utf8")) : { duration: scene.duration_sec || 45, segments: [] };
    const totalDur = subs.duration || scene.duration_sec || 45;
    const segs = (subs.segments || []).map((seg) => ({
      start: seg.start, end: seg.end, text: seg.text || "", toks: extractToks(seg.text || "")
    }));

    let cues = (scene.cues || []).map((c) => ({ ...c }));
    const { document: doc } = parseHTML(`<!doctype html><html><body><article id="stage">${scene.slide_html}</article></body></html>`);
    const stage = doc.getElementById("stage");
    const slideCard = stage.querySelector(".slide-card");
    if (!slideCard) continue;

    // 1. Pull late blank intro into [2.0s, 4.5s]
    const visAt0 = Array.from(slideCard.querySelectorAll(".box, .math-card, .proof-step, .svg-panel, .acad-table"))
      .filter((el) => !el.classList.contains("cue-hidden") && !el.closest(".cue-hidden")).length;
    const showCues = cues.filter((c) => c.action === "show").sort((a, b) => a.at - b.at);
    if (visAt0 === 0 && showCues.length > 0 && showCues[0].at > 4.6) {
      const oldAt = showCues[0].at;
      const naturalSeg = segs.find((sg) => sg.start >= 2.0 && sg.start <= 4.45);
      let newAt = naturalSeg ? Math.max(1.8, r2(naturalSeg.start - 0.08)) : 4.1;
      if (newAt > 4.5) newAt = 4.2;
      if (newAt < oldAt) {
        for (const c of cues) if (c.action === "show" && Math.abs(c.at - oldAt) < 0.05) c.at = newAt;
        stats.introsPulled++;
      }
    }

    const showAtMap = new Map();
    const hlCuesByEl = new Map();
    for (const c of cues) {
      try {
        slideCard.querySelectorAll(c.target).forEach((el) => {
          if (c.action === "show") {
            const prev = showAtMap.get(el);
            if (prev === undefined || c.at < prev) showAtMap.set(el, c.at);
          } else if (c.action === "highlight") {
            if (!hlCuesByEl.has(el)) hlCuesByEl.set(el, []);
            hlCuesByEl.get(el).push(c);
          }
        });
      } catch {}
    }

    const getShowAt = (el) => {
      let cur = el;
      while (cur && cur !== slideCard) {
        if (showAtMap.has(cur)) return showAtMap.get(cur);
        cur = cur.parentElement;
      }
      return 0;
    };

    // 2. Extend existing highlight cues without duration
    const sortedAll = [...cues].sort((a, b) => a.at - b.at);
    for (const c of cues) {
      if (c.action !== "highlight" || (typeof c.duration === "number" && c.duration > 0)) continue;
      let nextLimit = totalDur - 0.2;
      for (const other of sortedAll) {
        if (other !== c && other.at > c.at + 0.4 && other.target !== c.target) {
          nextLimit = Math.min(nextLimit, other.at - 0.15);
          break;
        }
      }
      const coveringSeg = segs.find((sg) => sg.start <= c.at + 0.5 && sg.end >= c.at);
      const minNatural = coveringSeg ? Math.max(4.0, coveringSeg.end - c.at + 0.3) : 4.5;
      const avail = nextLimit - c.at;
      const dur = avail >= 1.5 ? Math.min(avail, Math.max(minNatural, Math.min(avail, 18.0))) : Math.max(1.2, avail);
      c.duration = r2(Math.max(1.2, dur));
      stats.hlExtended++;
    }

    const tagLists = new Map();
    const getTagIndex = (el) => {
      const t = el.tagName.toLowerCase();
      if (!tagLists.has(t)) tagLists.set(t, Array.from(stage.querySelectorAll(t)));
      return tagLists.get(t).indexOf(el);
    };

    const insertions = [];
    const usedIds = new Set(Array.from(slideCard.querySelectorAll("[id]")).map((e) => e.id));
    const allocId = (prefix) => {
      let k = 1;
      while (usedIds.has(`${prefix}${k}`)) k++;
      const id = `${prefix}${k}`;
      usedIds.add(id);
      return id;
    };
    const newCues = [];

    // 3. Recap revealed <li> items
    const showLis = Array.from(slideCard.querySelectorAll("li")).filter((li) => showAtMap.has(li) && !li.closest(".verify-list"));
    if (showLis.length >= 2) {
      showLis.sort((a, b) => showAtMap.get(a) - showAtMap.get(b));
      for (let i = 0; i < showLis.length; i++) {
        const li = showLis[i];
        if (hlCuesByEl.has(li) || !li.id) continue;
        const sAt = showAtMap.get(li);
        const nextAt = i + 1 < showLis.length ? showAtMap.get(showLis[i + 1]) : totalDur - 0.15;
        const dur = nextAt - sAt - 0.25;
        if (dur >= 1.2) {
          newCues.push({ at: r2(sAt + 0.08), action: "highlight", target: `#${li.id}`, duration: r2(dur) });
          hlCuesByEl.set(li, [newCues[newCues.length - 1]]);
          stats.recapLiHlAdded++;
        }
      }
    }

    const blockSel = ".box, .math-card, .proof-step, .svg-panel, .acad-table, .pill-strip, .metrics-row";
    const topBlocks = Array.from(slideCard.querySelectorAll(blockSel)).filter(
      (el) => !el.parentElement?.closest(".box, .math-card, .proof-step, .svg-panel")
    );
    const hasAnyHlIn = (el) => {
      if (hlCuesByEl.has(el)) return true;
      for (const hEl of hlCuesByEl.keys()) if (el.contains(hEl)) return true;
      return false;
    };

    // 4. Sibling boxes inside shared .grid-2/.grid-3/.grid-4 show containers
    const handledBlocks = new Set();
    const gridContainers = Array.from(slideCard.querySelectorAll(".grid-2, .grid-3, .grid-4")).filter((g) => showAtMap.has(g));
    for (const g of gridContainers) {
      const kids = Array.from(g.children).filter((ch) =>
        (ch.classList.contains("box") || ch.classList.contains("math-card") || ch.classList.contains("svg-panel")) &&
        !showAtMap.has(ch) && !ch.classList.contains("cue-hidden")
      );
      if (kids.length >= 2 && kids.length <= 4 && !hasAnyHlIn(g)) {
        const gStart = getShowAt(g);
        let gEnd = totalDur - 0.15;
        for (const sc of cues) if (sc.action === "show" && sc.at > gStart + 0.5 && sc.at < gEnd) gEnd = sc.at;
        const segsInWin = segs.filter((sg) => sg.end >= gStart - 0.2 && sg.start <= gEnd - 0.5);
        const aligned = alignMonotonicItems(kids.map((k) => extractToks(k.textContent)), segsInWin, gStart, gEnd);
        if (aligned) {
          for (let i = 0; i < kids.length; i++) {
            const kEl = kids[i];
            let kid = kEl.id;
            if (!kid) {
              kid = allocId(`gb${sIdx + 1}-`);
              insertions.push({ tagName: kEl.tagName, occurrenceIndex: getTagIndex(kEl), newId: kid });
            }
            newCues.push({ at: aligned[i].start, action: "highlight", target: `#${kid}`, duration: aligned[i].dur });
            hlCuesByEl.set(kEl, [newCues[newCues.length - 1]]);
            handledBlocks.add(kEl);
            stats.granularAdded++;
          }
        }
      }
    }

    // 5. Granular li / tr / .metric or block highlight
    for (const bEl of topBlocks) {
      if (handledBlocks.has(bEl) || bEl.querySelector(".verify-list") || hasAnyHlIn(bEl)) continue;
      const bStart = getShowAt(bEl);
      let bEnd = totalDur - 0.15;
      const otherShows = topBlocks
        .filter((o) => o !== bEl && !o.querySelector(".verify-list"))
        .map((o) => getShowAt(o))
        .filter((t) => t > bStart + 0.5)
        .sort((a, b) => a - b);
      if (otherShows.length > 0) bEnd = Math.min(bEnd, otherShows[0]);
      if (bEnd - bStart < 2.2) continue;

      const lis = Array.from(bEl.querySelectorAll("ol.algo-list > li, ul.clean-list > li")).filter(
        (li) => !showAtMap.has(li) && !li.classList.contains("cue-hidden")
      );
      if (lis.length >= 2 && lis.length <= 6) {
        const segsInWin = segs.filter((sg) => sg.end >= bStart - 0.2 && sg.start <= bEnd - 0.4);
        const aligned = alignMonotonicItems(lis.map((li) => extractToks(li.textContent)), segsInWin, bStart, bEnd);
        if (aligned) {
          for (let i = 0; i < lis.length; i++) {
            let id = lis[i].id;
            if (!id) { id = allocId(`li${sIdx + 1}-`); insertions.push({ tagName: "li", occurrenceIndex: getTagIndex(lis[i]), newId: id }); }
            newCues.push({ at: aligned[i].start, action: "highlight", target: `#${id}`, duration: aligned[i].dur });
            hlCuesByEl.set(lis[i], [newCues[newCues.length - 1]]);
            stats.granularAdded++;
          }
          continue;
        }
      }

      if (bEl.tagName === "TABLE") {
        const trs = Array.from(bEl.querySelectorAll("tbody > tr")).filter((tr) => !showAtMap.has(tr) && !tr.classList.contains("cue-hidden"));
        if (trs.length >= 2 && trs.length <= 6) {
          const segsInWin = segs.filter((sg) => sg.end >= bStart - 0.2 && sg.start <= bEnd - 0.4);
          const aligned = alignMonotonicItems(trs.map((tr) => extractToks(tr.textContent)), segsInWin, bStart, bEnd);
          if (aligned) {
            for (let i = 0; i < trs.length; i++) {
              let id = trs[i].id;
              if (!id) { id = allocId(`tr${sIdx + 1}-`); insertions.push({ tagName: "tr", occurrenceIndex: getTagIndex(trs[i]), newId: id }); }
              newCues.push({ at: aligned[i].start, action: "highlight", target: `#${id}`, duration: aligned[i].dur });
              hlCuesByEl.set(trs[i], [newCues[newCues.length - 1]]);
              stats.granularAdded++;
            }
            continue;
          }
        }
      }

      if (bEl.classList.contains("metrics-row")) {
        const mets = Array.from(bEl.querySelectorAll(":scope > .metric"));
        if (mets.length >= 2 && mets.length <= 5) {
          const segsInWin = segs.filter((sg) => sg.end >= bStart - 0.2 && sg.start <= bEnd - 0.4);
          const aligned = alignMonotonicItems(mets.map((m) => extractToks(m.textContent)), segsInWin, bStart, bEnd);
          if (aligned) {
            for (let i = 0; i < mets.length; i++) {
              let id = mets[i].id;
              if (!id) { id = allocId(`met${sIdx + 1}-`); insertions.push({ tagName: mets[i].tagName, occurrenceIndex: getTagIndex(mets[i]), newId: id }); }
              newCues.push({ at: aligned[i].start, action: "highlight", target: `#${id}`, duration: aligned[i].dur });
              hlCuesByEl.set(mets[i], [newCues[newCues.length - 1]]);
              stats.granularAdded++;
            }
            continue;
          }
        }
      }

      if (bEl.id && bStart >= 5.0 && !bEl.classList.contains("svg-panel")) {
        newCues.push({ at: r2(bStart + 0.1), action: "highlight", target: `#${bEl.id}`, duration: r2(Math.max(1.5, bEnd - bStart - 0.3)) });
        stats.blockHlAdded++;
      }
    }

    cues = [...cues, ...newCues].sort((a, b) => a.at - b.at || (a.action === "show" ? -1 : 1));
    const hlOnly = cues.filter((c) => c.action === "highlight");
    for (let i = 0; i < hlOnly.length; i++) {
      const cur = hlOnly[i];
      const next = i + 1 < hlOnly.length ? hlOnly[i + 1] : null;
      if (next && next.at > cur.at + 0.1 && cur.at + (cur.duration || 4) > next.at - 0.1) {
        cur.duration = r2(Math.max(0.8, next.at - cur.at - 0.12));
      }
    }

    if (insertions.length > 0) scene.slide_html = injectIdsIntoHtml(scene.slide_html, insertions);
    scene.cues = cues;
  }

  fs.writeFileSync(lPath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

console.log("POLISH STATS:", JSON.stringify(stats));
