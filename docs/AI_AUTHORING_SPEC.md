# AI Authoring Spec — `lesson.json` Contract

Follow this contract when generating chapters in `videolezioni/lessons/<slug>/lesson.json` so every scene renders crisply at `1280×800`, passes all 7 `verify_sync.mjs` invariants on the first try, and aligns cleanly with TTS audio.

---

## 1. JSON Structure

```json
{
  "lesson_id": "01-introduzione",
  "chapter": 1,
  "part": "Parte I · Fondamenti",
  "title": "Titolo del capitolo",
  "voice_config": {
    "provider": "gemini",
    "model": "gemini-2.5-flash-preview-tts",
    "voice_name": "Kore",
    "style": "chiaro, didattico, calmo e preciso"
  },
  "scenes": [
    {
      "id": "scene-01",
      "section": "1.1 · Sezione",
      "title": "Titolo conciso della scena",
      "tts_text": "Testo parlato naturale... [pause:0.6] Seconda frase...",
      "slide_html": "<div class=\"slide-card\">...</div>",
      "cues": [
        { "at": 3.2, "action": "show", "target": "#s1", "anchor": "prime parole" }
      ],
      "audio_file": "audio/scene-01.wav",
      "subtitle_file": "subtitles/scene-01.json",
      "duration_sec": 65.0
    }
  ]
}
```

---

## 2. Pacing & Layout Rules (Zero Scroll at `1280×800`)

- **Scene length**: 55–105 seconds (~130–250 words in `tts_text`). Split dense topics into 2 scenes rather than cramming one slide.
- **Short intros**: First `show` cue MUST be `<= 4.5s` (`polish_sync.mjs` enforces this automatically too).
- **Compact slide density**: Max 2–4 visual blocks per `.slide-card` (e.g. 1 `.grid-2` + 1 bottom `.box-idea`, or 1 `.split-visual` with SVG + `.formula-col`). Never put walls of text. If `verify_browser.mjs` warns that a scene drops below `zoom: 0.72` at `1280×800`, split it into two scenes.
- **Sibling cards (`.grid-2` / `.grid-3`)**: If two or more cards share the exact same `show` timestamp, ALWAYS assign dedicated non-overlapping `highlight` cues (or staggered `show` times) so `live-sync.js` routes spoken math and clauses to the active card instead of bleeding across siblings.
- **Unique IDs & non-overlapping highlights**: Every `id="..."` inside a scene MUST be unique (`dupId = 0`), and two `highlight` cues targeting the same element must never overlap in time (`cOv = 0`).
- **Closing scene**: End every chapter with a recap scene: left `.box-algo` with 3–5 `<li id="s1" class="cue-hidden">` key takeaways, right `.box-theorem` with `<ol class="verify-list">` review questions.

---

## 3. Approved HTML Components

Inside `<div class="slide-card">`:
- Header: `<div class="slide-kicker">...</div>` + `<h2 class="slide-title">...</h2>`
- Layouts: `.grid-2`, `.grid-3`, `.split-visual` (diagram + `.formula-col`), `.metrics-row` (`.metric` cards), `.pill-strip` (`.pill` badges)
- Boxes: `.box.box-def`, `.box.box-primary`, `.box.box-theorem`, `.box.box-algo`, `.box.box-idea`, `.box.box-warn` (each with `<div class="box-label">...</div>`)
- Math cards: `.math-card` / `.math-card.math-card-accent` (with `<div class="step-tag-inline">...</div>` and `<p class="math-note">...</p>`)
- Proof chains: `.proof-steps` > `.proof-step` (`.step-tag`) + `.proof-step.proof-step-final`
- Lists & tables: `<ol class="algo-list">`, `<ul class="clean-list">`, `<table class="acad-table">`
- Diagrams: `<div id="s1" class="svg-panel cue-hidden"><svg viewBox="0 0 360 180" class="diagram-svg">...</svg></div>`
  - Use theme-adaptive classes: `.svg-axis`, `.svg-edge`, `.svg-curve-blue`, `.svg-curve-red`, `.svg-curve-green`, `.svg-caption`, `.svg-tick`, `.svg-math`.
  - **Dark-mode safe SVG**: Avoid hardcoded `fill="#fff"` / `stroke="#000"` when possible; prefer CSS variables (`var(--ink)`, `var(--bg-surface)`, `var(--blue)`, `var(--red)`, `var(--green)`) and keep `<text>` labels well spaced (`verify_browser.mjs` flags overlapping `<text>` bounding boxes).
  - Group sub-regions in `<g id="...">` to highlight specific parts during narration.

---

## 4. KaTeX & TTS Alignment Rules

- Inline math: `\\( ... \\)`, display math: `\\[ ... \\]` (escaped in JSON!).
- Wrap key sub-formulas to highlight with `\\htmlId{f-unique}{...}`.
- **CRITICAL**: Inside `\\htmlId{...}{...}`, ALWAYS use `\\gt` and `\\lt` (NEVER `&gt;` or `&lt;`, which breaks KaTeX!).
- **TTS writing rules** (for clean pronunciation & MMS_FA alignment):
  - Spell out math cleanly in the target language: e.g. `"f di x uguale"`, `"x al quadrato"`, `"theta stella"`, `"zero virgola uno"`, `"somma da i uguale uno a n"`.
  - Use `[pause:0.6]` or `[pause:0.8]` between logical beats (stripped automatically before alignment).
  - Avoid raw ASCII symbols like `->`, `>=`, `<=`, `^2` inside `tts_text`.
- **Granular cues**: Add unique `id`s on `<li>`, `<tr>`, `<td>`, `.metric`, and `.box` elements; after TTS + `align_audio.py`, run `npm run polish` to auto-align all `at` and `duration` values deterministically, then verify with `npm run verify:all` (both the 9-invariant sync gate and headless Chrome layout/multi-mode/mobile gate)!
