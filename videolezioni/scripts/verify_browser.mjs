// Zero-Dependency Headless Chrome Browser Quality Gate (CDP over native Node fetch + WebSocket)
// Checks real layout & interaction across all ready scenes, modes (Normal/Theater/Clean),
// viewports (Desktop 1280x800, Wide 1440x900, Mobile 390x844), and all 4 themes.
// Usage: node videolezioni/scripts/verify_browser.mjs [optional-lesson-id] [--strict-audio] [--verbose]

import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(ROOT, "..");

const args = process.argv.slice(2);
const filterLesson = args.find((a) => !a.startsWith("--")) || null;
const strictAudio = args.includes("--strict-audio");
const verbose = args.includes("--verbose");

if (typeof globalThis.WebSocket !== "function") {
  console.error("verify_browser.mjs requires Node.js >= 22 (native WebSocket).");
  process.exit(1);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav"
};

function findChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  for (const cmd of ["google-chrome", "chromium", "chromium-browser"]) {
    try {
      const found = execFileSync("which", [cmd], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      if (found && fs.existsSync(found)) return found;
    } catch {}
  }
  return null;
}

function startStaticServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const cleanUrl = decodeURIComponent((req.url || "/").split("?")[0].split("#")[0]);
      let filePath;
      if (cleanUrl === "/course.config.json") {
        filePath = path.join(REPO_ROOT, "course.config.json");
      } else {
        const rel = cleanUrl === "/" ? "index.html" : cleanUrl.replace(/^\/+/, "");
        filePath = path.resolve(ROOT, rel);
        if (!filePath.startsWith(ROOT)) {
          res.writeHead(403);
          res.end();
          return;
        }
        if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
          filePath = path.join(filePath, "index.html");
        }
      }
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        "Content-Type": MIME[ext] || "application/octet-stream",
        "Cache-Control": "no-store"
      });
      fs.createReadStream(filePath).pipe(res);
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}` });
    });
  });
}

async function waitForCdp(port) {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await r.json();
      const page = list.find((t) => t.type === "page");
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("Timed out waiting for headless Chrome CDP endpoint");
}

function createCdpClient(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let nextId = 1;
    const pending = new Map();
    const listeners = new Map();

    ws.addEventListener("open", () => {
      const send = (method, params = {}) =>
        new Promise((res, rej) => {
          const id = nextId++;
          pending.set(id, { res, rej });
          ws.send(JSON.stringify({ id, method, params }));
        });
      const on = (event, fn) => {
        if (!listeners.has(event)) listeners.set(event, []);
        listeners.get(event).push(fn);
      };
      resolve({ send, on, close: () => ws.close() });
    });

    ws.addEventListener("error", (err) => reject(err));
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(`${msg.error.message} (${msg.error.code})`));
        else res(msg.result);
      } else if (msg.method && listeners.has(msg.method)) {
        for (const fn of listeners.get(msg.method)) fn(msg.params);
      }
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CHROME = findChrome();
if (!CHROME) {
  console.error("No Chrome/Chromium binary found. Set CHROME_PATH or install Chrome/Chromium.");
  process.exit(1);
}

const manifestPath = path.join(ROOT, "lessons/manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const lessons = filterLesson
  ? manifest.lessons.filter((l) => l.id === filterLesson)
  : manifest.lessons.filter((l) => l.status === "ready");

if (lessons.length === 0) {
  console.error(`No matching ready lessons found${filterLesson ? ` for "${filterLesson}"` : ""}.`);
  process.exit(1);
}

const { server, baseUrl } = await startStaticServer();
const cdpPort = 9222 + Math.floor(Math.random() * 500);
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lectio-verify-"));
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${cdpPort}`,
    "--window-size=1280,800",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--remote-allow-origins=*",
    "--no-sandbox",
    `--user-data-dir=${userDataDir}`,
    "about:blank"
  ],
  { stdio: "ignore" }
);

const report = {
  totalScenes: 0,
  consoleErrors: [],
  pageErrors: [],
  failedRequests: [],
  catalogIssues: [],
  katexErrors: [],
  overflows: [],
  svgOverlaps: [],
  modeIssues: [],
  mobileIssues: [],
  themeIssues: [],
  a11yIssues: [],
  lowZoomWarnings: []
};

try {
  const wsUrl = await waitForCdp(cdpPort);
  const cdp = await createCdpClient(wsUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Network.enable");

  let activeContext = "init";
  cdp.on("Runtime.exceptionThrown", (p) => {
    report.pageErrors.push(`${activeContext}: ${p.exceptionDetails?.text || "exception"}`);
  });
  cdp.on("Runtime.consoleAPICalled", (p) => {
    if (p.type === "error") {
      const txt = (p.args || []).map((a) => a.value ?? a.description ?? "").join(" ");
      if (!strictAudio && /404|audio\//i.test(txt)) return;
      report.consoleErrors.push(`${activeContext}: ${txt}`);
    }
  });
  cdp.on("Network.responseReceived", (p) => {
    const url = p.response?.url || "";
    const status = p.response?.status || 0;
    if (!url.startsWith(baseUrl)) return;
    if (status >= 400) {
      if (!strictAudio && /\/audio\/[^/]+\.(wav|mp3)$/i.test(url)) return;
      report.failedRequests.push(`${activeContext}: HTTP ${status} ${url.replace(baseUrl, "")}`);
    }
  });

  const evalJs = async (expression) => {
    const r = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      throw new Error(`Eval error in ${activeContext}: ${r.exceptionDetails.text}`);
    }
    return r.result?.value;
  };

  const setViewport = async (width, height, mobile = false) => {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile
    });
  };

  const navigate = async (urlPath) => {
    const loadP = new Promise((res) => {
      const handler = () => res();
      cdp.on("Page.loadEventFired", handler);
    });
    await cdp.send("Page.navigate", { url: `${baseUrl}${urlPath}` });
    await Promise.race([loadP, sleep(6000)]);
    await sleep(300);
  };

  // -------------------------------------------------------------------------
  // 1. Catalog Hub Smoke Test
  // -------------------------------------------------------------------------
  activeContext = "catalog";
  await setViewport(1280, 800, false);
  await navigate("/index.html");
  await sleep(350);

  const catCheck = await evalJs(`(() => {
    const tabs = Array.from(document.querySelectorAll('.view-btn')).map((b) => ({
      view: b.dataset.view,
      role: b.getAttribute('role'),
      sel: b.getAttribute('aria-selected')
    }));
    const cards = document.querySelectorAll('.map-node, .bento-card').length;
    const bentoBtn = document.querySelector('.view-btn[data-view="bento"]');
    if (bentoBtn) bentoBtn.click();
    const bentoSel = bentoBtn ? bentoBtn.getAttribute('aria-selected') : null;
    const mapBtn = document.querySelector('.view-btn[data-view="map"]');
    if (mapBtn) mapBtn.click();
    const searchBtn = document.getElementById('btn-global-search-home');
    if (searchBtn) searchBtn.click();
    const searchOpen = Boolean(document.querySelector('.gsearch-backdrop.open'));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const searchClosed = !document.querySelector('.gsearch-backdrop.open');
    return { tabs, cards, bentoSel, searchOpen, searchClosed };
  })()`);

  if (!catCheck || catCheck.cards === 0) report.catalogIssues.push("No lesson cards rendered in catalog");
  if (!catCheck?.tabs?.every((t) => t.role === "tab")) report.catalogIssues.push("Catalog view buttons missing role=tab");
  if (catCheck?.bentoSel !== "true") report.catalogIssues.push("Catalog Bento tab aria-selected did not toggle");
  if (!catCheck?.searchOpen || !catCheck?.searchClosed) report.catalogIssues.push("Global search modal open/close failed");

  // -------------------------------------------------------------------------
  // 2. Full-Course Scene Sweep at 1280x800
  // -------------------------------------------------------------------------
  let sampleListRef = null;
  let sampleSvgRef = null;
  let sampleFirstRef = null;

  for (const lesson of lessons) {
    activeContext = lesson.id;
    await navigate(`/lesson.html?id=${encodeURIComponent(lesson.id)}`);
    await evalJs(`new Promise((resolve) => {
      const start = Date.now();
      const poll = () => {
        if (window.__LESSON_PLAYER__ && document.querySelector('.slide-card')) return resolve(true);
        if (Date.now() - start > 6000) return resolve(false);
        setTimeout(poll, 80);
      };
      poll();
    })`);

    const totalScenes = await evalJs(`window.__LESSON_PLAYER__ ? window.__LESSON_PLAYER__.getState().scenesCount : 0`);
    if (!totalScenes) {
      report.pageErrors.push(`${lesson.id}: player did not initialize`);
      continue;
    }

    // Reveal all blocks so hidden boxes, lists, and SVGs are checked for layout & KaTeX
    await evalJs(`(() => {
      const btn = document.getElementById('toggle-reveal-all');
      if (btn && !btn.classList.contains('active')) btn.click();
    })()`);

    for (let i = 0; i < totalScenes; i++) {
      const ref = `${lesson.id}/S${String(i + 1).padStart(2, "0")}`;
      activeContext = ref;
      report.totalScenes++;

      if (i > 0) {
        await evalJs(`window.__LESSON_PLAYER__.goToScene(${i})`);
        await sleep(160);
      } else {
        await sleep(160);
      }

      const m = await evalJs(`(() => {
        const card = document.querySelector('.slide-card');
        const frame = document.getElementById('slide-frame');
        const vp = frame ? frame.parentElement : null;
        if (!card || !frame || !vp) return { missing: true };
        const st = window.__LESSON_PLAYER__.getState();
        const kErr = document.querySelectorAll('.katex-error').length;
        const cardRect = card.getBoundingClientRect();
        const vpRect = vp.getBoundingClientRect();
        const fs = getComputedStyle(frame);
        const vpStyle = getComputedStyle(vp);
        const padY = (parseFloat(fs.paddingTop) || 0) + (parseFloat(fs.paddingBottom) || 0)
          + (parseFloat(vpStyle.paddingTop) || 0) + (parseFloat(vpStyle.paddingBottom) || 0);
        const availH = vpRect.height - padY;
        const horizOv = card.scrollWidth > card.clientWidth + 3;
        const vertOv = cardRect.height > availH + 6;

        // Detect overlapping SVG <text> labels
        const svgOverlaps = [];
        for (const svg of card.querySelectorAll('svg.diagram-svg')) {
          const texts = Array.from(svg.querySelectorAll('text'))
            .filter((t) => (t.textContent || '').trim().length > 0 && getComputedStyle(t).display !== 'none' && getComputedStyle(t).visibility !== 'hidden')
            .map((t) => ({ txt: (t.textContent || '').trim().slice(0, 24), r: t.getBoundingClientRect() }))
            .filter((x) => x.r.width > 2 && x.r.height > 2);
          for (let a = 0; a < texts.length; a++) {
            for (let b = a + 1; b < texts.length; b++) {
              const r1 = texts[a].r, r2 = texts[b].r;
              const ox = Math.min(r1.right, r2.right) - Math.max(r1.left, r2.left);
              const oy = Math.min(r1.bottom, r2.bottom) - Math.max(r1.top, r2.top);
              if (ox > 4 && oy > 4) {
                svgOverlaps.push(texts[a].txt + ' / ' + texts[b].txt);
              }
            }
          }
        }

        const hasList = Boolean(card.querySelector('ol.algo-list, ol.clean-list, ul.clean-list, ol.verify-list'));
        const hasSvg = Boolean(card.querySelector('svg.diagram-svg'));
        return {
          zoom: st.slideZoom,
          kErr,
          horizOv,
          vertOv,
          svgOverlaps,
          hasList,
          hasSvg
        };
      })()`);

      if (m.missing) {
        report.pageErrors.push(`${ref}: missing .slide-card`);
        continue;
      }
      if (!sampleFirstRef) sampleFirstRef = { lessonId: lesson.id, idx: i, ref };
      if (!sampleListRef && m.hasList) sampleListRef = { lessonId: lesson.id, idx: i, ref };
      if (!sampleSvgRef && m.hasSvg) sampleSvgRef = { lessonId: lesson.id, idx: i, ref };

      if (m.kErr > 0) report.katexErrors.push(`${ref}: ${m.kErr} KaTeX errors`);
      if (m.horizOv || m.vertOv) report.overflows.push(`${ref}: horiz=${m.horizOv} vert=${m.vertOv} zoom=${m.zoom}`);
      if (m.svgOverlaps.length > 0) report.svgOverlaps.push(`${ref}: ${m.svgOverlaps.join("; ")}`);
      if (m.zoom < 0.70) report.lowZoomWarnings.push(`${ref}: zoom=${m.zoom}`);
      if (verbose) console.log(`  [OK] ${ref} zoom=${m.zoom}`);
    }
  }

  // -------------------------------------------------------------------------
  // 3. Multi-Mode (Normal/Theater/Clean), Mobile (390x844), Themes & A11y
  // -------------------------------------------------------------------------
  const targetSample = sampleListRef || sampleFirstRef;
  if (targetSample) {
    activeContext = `matrix:${targetSample.ref}`;
    await setViewport(1440, 900, false);
    await navigate(`/lesson.html?id=${encodeURIComponent(targetSample.lessonId)}&scena=${targetSample.idx + 1}`);
    await sleep(350);

    // Keyboard modifier safety + a11y attributes
    const a11y = await evalJs(`(() => {
      const subBtn = document.getElementById('toggle-subtitles');
      const beforeSub = subBtn?.getAttribute('aria-pressed');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', metaKey: true, bubbles: true }));
      const afterCmdC = subBtn?.getAttribute('aria-pressed');
      const scrubberRole = document.getElementById('scrubber-wrap')?.getAttribute('role');
      const pressedBtns = document.querySelectorAll('.topbar-icon-group button[aria-pressed]').length;
      return { beforeSub, afterCmdC, scrubberRole, pressedBtns };
    })()`);
    if (a11y.beforeSub !== a11y.afterCmdC) report.a11yIssues.push("Cmd+C toggled subtitles");
    if (a11y.scrubberRole !== "slider") report.a11yIssues.push("Scrubber missing role=slider");
    if (a11y.pressedBtns < 6) report.a11yIssues.push(`Expected >=6 toolbar aria-pressed buttons, got ${a11y.pressedBtns}`);

    // Reveal all & check Normal, Theater, Clean modes (including Clean dock clearance & list bounds)
    await evalJs(`(() => {
      const btn = document.getElementById('toggle-reveal-all');
      if (btn && !btn.classList.contains('active')) btn.click();
    })()`);

    for (const mode of ["normal", "theater", "clean"]) {
      await evalJs(`(() => {
        window.__LESSON_PLAYER__.setCleanMode(${mode === "clean"});
        window.__LESSON_PLAYER__.setTheaterMode(${mode === "theater"});
        if (${mode === "clean"}) document.body.classList.add('clean-ui-visible');
      })()`);
      await sleep(350);

      const mCheck = await evalJs(`(() => {
        const issues = [];
        const bodyOv = document.documentElement.scrollWidth > window.innerWidth + 1;
        if (bodyOv) issues.push('horizontal body overflow');
        if (${mode === "clean"}) {
          const sub = document.getElementById('subtitle-dock');
          const bar = document.getElementById('control-bar');
          if (sub && bar && !sub.classList.contains('hidden')) {
            const sr = sub.getBoundingClientRect();
            const br = bar.getBoundingClientRect();
            if (sr.bottom > br.top + 1) {
              issues.push('clean subtitle-dock overlaps control-bar by ' + (sr.bottom - br.top).toFixed(1) + 'px');
            }
          }
        }
        for (const list of document.querySelectorAll('ol.algo-list, ol.clean-list, ul.clean-list, ol.verify-list')) {
          const parent = list.closest('.box, .math-card, .slide-card') || list;
          const pr = parent.getBoundingClientRect();
          for (const li of list.querySelectorAll(':scope > li')) {
            const lr = li.getBoundingClientRect();
            if (lr.left < pr.left - 1) issues.push('list item spills left of container');
            if (lr.right > pr.right + 1) issues.push('list item spills right of container');
          }
        }
        return issues;
      })()`);
      for (const iss of mCheck) report.modeIssues.push(`${mode}: ${iss}`);
    }

    // Reset modes & test all 4 themes
    await evalJs(`(() => {
      window.__LESSON_PLAYER__.setCleanMode(false);
      window.__LESSON_PLAYER__.setTheaterMode(false);
    })()`);
    for (const theme of ["studio", "carbon", "glass", "arcade"]) {
      await evalJs(`document.querySelector('.theme-pill[data-theme="${theme}"]')?.click()`);
      await sleep(140);
      const tOk = await evalJs(`(() => {
        const applied = document.documentElement.getAttribute('data-theme');
        let arcadeKatexOk = true;
        if (applied === 'arcade') {
          const k = document.querySelector('.box-label .katex, .step-tag-inline .katex');
          if (k && parseFloat(getComputedStyle(k).fontSize) < 12) arcadeKatexOk = false;
        }
        return { applied, arcadeKatexOk };
      })()`);
      if (tOk.applied !== theme) report.themeIssues.push(`Theme ${theme} did not apply`);
      if (!tOk.arcadeKatexOk) report.themeIssues.push("Arcade box-label KaTeX font size < 12px");
    }

    // Mobile 390x844 check
    activeContext = `mobile:${targetSample.ref}`;
    await setViewport(390, 844, true);
    await navigate(`/lesson.html?id=${encodeURIComponent(targetSample.lessonId)}&scena=${targetSample.idx + 1}`);
    await sleep(350);
    await evalJs(`(() => {
      const btn = document.getElementById('toggle-reveal-all');
      if (btn && !btn.classList.contains('active')) btn.click();
    })()`);
    await sleep(200);
    const mob = await evalJs(`(() => {
      const bodyOv = document.documentElement.scrollWidth > window.innerWidth + 1;
      const tb = document.querySelector('.topbar');
      const tag = document.getElementById('lesson-chap-tag');
      const tagOv = tb && tag ? tag.getBoundingClientRect().right > tb.getBoundingClientRect().right + 1 : false;
      const kd = document.querySelector('.katex-display');
      const kdScrollable = !kd || getComputedStyle(kd).overflowX === 'auto';
      return { bodyOv, tagOv, kdScrollable };
    })()`);
    if (mob.bodyOv) report.mobileIssues.push("Mobile 390x844 horizontal body overflow");
    if (mob.tagOv) report.mobileIssues.push("Mobile topbar chapter tag overflow");
    if (!mob.kdScrollable) report.mobileIssues.push("Mobile .katex-display missing overflow-x: auto");
  }

  cdp.close();
} finally {
  chrome.kill("SIGKILL");
  server.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
}

const hardFails =
  report.consoleErrors.length +
  report.pageErrors.length +
  report.failedRequests.length +
  report.catalogIssues.length +
  report.katexErrors.length +
  report.overflows.length +
  report.svgOverlaps.length +
  report.modeIssues.length +
  report.mobileIssues.length +
  report.themeIssues.length +
  report.a11yIssues.length;

console.log(
  `BROWSER GATE (${report.totalScenes} sc): console=${report.consoleErrors.length} | pageErr=${report.pageErrors.length} | net404=${report.failedRequests.length} | kErr=${report.katexErrors.length} | ov=${report.overflows.length} | svgOv=${report.svgOverlaps.length} | modes=${report.modeIssues.length} | mobile=${report.mobileIssues.length} | themes=${report.themeIssues.length} | a11y=${report.a11yIssues.length} | cat=${report.catalogIssues.length}${report.lowZoomWarnings.length ? ` | lowZoomWarn=${report.lowZoomWarnings.length}` : ""}`
);

if (hardFails > 0 || verbose) {
  for (const [k, arr] of Object.entries(report)) {
    if (Array.isArray(arr) && arr.length > 0) {
      console.log(`  [${k}]`, arr.join(" | "));
    }
  }
}

if (hardFails > 0) process.exit(1);
