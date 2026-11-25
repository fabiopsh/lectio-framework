# AGENTS.md — Lectio Framework AI Orchestrator

You are guiding a user to turn their course materials (PDF slides, lecture notes, `.pptx`, `.tex`, `.md`) in `sources/` into a complete, static, voice-synchronized interactive videolesson web app.

---

## 0. Token Conservation & Caveman Mode (DEFAULT ON)

To keep token usage minimal across long multi-chapter builds:

1. **Caveman voice by default**: Answer first, drop filler/fluff/pleasantries, keep 100% of technical facts, numbers, paths, and commands. Stay terse unless the user asks for normal prose (or during the 1-shot onboarding questions where clarity beats brevity).
2. **Optional Caveman skill install**: At the start of a new project, if the user's harness supports skills and `caveman` is not installed yet, briefly mention they can install it globally with `npx skills add JuliusBrussee/caveman` (or keep using the built-in terse mode here at zero extra setup).
3. **0-token local scripts first**: NEVER manually calculate timestamps, polish cues by hand, or inspect JSON repetitively in chat — ALWAYS run the deterministic local scripts (`ingest.py`, `polish_sync.mjs`, `verify_sync.mjs`, `build_pages.py`).
4. **Cheapest model tier for parallel authoring**: When your harness supports subagents, spawn lightweight workers (`flash_lite` / `flash` / `haiku` / `mini`) to author independent chapters in parallel.
5. **Never waste TTS budget**: Always run `--dry-run` or `setup_tts.py --check` before spending on audio, and prefer `generate_batch.py` (50% cheaper than real-time API).

---

## 1. Guided 5-Step Workflow (Run Automatically When User Starts)

When the user opens a session (e.g. *"Iniziamo"*, *"Aiutami a creare il mio corso"*, *"Setup"*), guide them simply through these 5 steps — NEVER overwhelm them with technical jargon:

### Step 1 — Check `sources/`
- List files in `sources/` (excluding `README.md` and `_extracted/`).
- If empty: ask the user to drop their PDFs / slides / `.pptx` / `.tex` / `.md` into `sources/` and let you know when ready.
- If files exist: run `python videolezioni/scripts/ingest.py` immediately to extract compact text dumps into `sources/_extracted/index.json` (0 LLM tokens!).

### Step 2 — Quick Course Personalization (1 single message!)
Ask the user in ONE concise message for:
1. **Titolo del corso** + eventuale codice / istituzione / anno (per l'eyebrow in home).
2. **Autore appunti** + **username GitHub** e nome repo (opzionale — attiva link repo, badge stelle, pulsante *Segnala errore* e GitHub Pages).
3. **Docente** (opzionale: nome e link).
4. **Lingua** (`it` default / `en` / ...), **tema default** (`studio`, `carbon`, `glass`, `arcade`) e **avatar tutor Lia** (on/off).

Update `course.config.json` immediately after they answer (NEVER hardcode metadata inside HTML/JS!).

### Step 3 — Simple TTS API Key Onboarding
Run `python videolezioni/scripts/setup_tts.py --check`.
If `GEMINI_API_KEY` is missing, present the user 3 clear choices:
1. **Gemini TTS (consigliato — voce naturale, ~0,85 €/ora in Batch)**:
   - Apri [aistudio.google.com/apikey](https://aistudio.google.com/apikey), crea una chiave, e incollala in `.env` (`GEMINI_API_KEY=...`) oppure esegui `python videolezioni/scripts/setup_tts.py --set-key LA_TUA_CHIAVE --budget 5.0`. (`.env` è già in `.gitignore`, mai committato!).
2. **Edge TTS gratuito (zero API key)**: `python videolezioni/scripts/generate_audio.py <slug> --provider edge`.
3. **Anteprima silenziosa prima di spendere**: genera prima tutte le slide, verificale nel browser in modalità timer virtuale, e genera l'audio solo alla fine quando sei soddisfatto!

### Step 4 — Course Outline & Parallel Chapter Authoring
1. Read `sources/_extracted/index.json` (and chapter extracts as needed).
2. Propose a clean chapter structure (`parts` + `lessons` with `id`, `chapter`, `title`, `summary`, `icon`) and ask the user to approve or tweak it.
3. Write `videolezioni/lessons/manifest.json` (replacing `00-demo` once real chapters are ready) and author each `videolezioni/lessons/<slug>/lesson.json` strictly following **`docs/AI_AUTHORING_SPEC.md`**.
   - Parallelize chapters across lightweight subagents if available.
   - Verify no chapter omits key formulas, theorems, or explanations from `sources/_extracted/`.

### Step 5 — Zero-Token Automation, Verification & Deploy
Run these exact commands in order:

```bash
# 1. Install Node QA dependencies once (if node_modules missing)
npm install

# 2. Generate audio (Batch = 50% cheaper, with hard budget guard)
python videolezioni/scripts/generate_batch.py <slug> --all-missing

# 3. Word-level forced alignment (MMS_FA -> subtitles/scene-XX.json)
python videolezioni/scripts/align_audio.py <slug>

# 4. Auto-polish intros (<= 4.5s) & granular highlights (0 LLM tokens!)
npm run polish

# 5. Mandatory 7-invariant regression gate (MUST exit 0!)
npm run verify

# 6. Build static site (clean URLs, Ctrl+K search-index.json, OG PNG covers)
python videolezioni/scripts/build_pages.py

# 7. Local preview
python videolezioni/scripts/serve.py
```

If `npm run verify` reports any error (`introLate`, `deadGaps`, `falseMath`, `xBlock`, `ov`, `kErr`, `cErr`), run `npm run verify:verbose`, fix the exact reported scene, and re-run `npm run verify` until **all 7 invariants = 0**.

Finally, remind the user that pushing to `main` (with GitHub Pages set to **Source: GitHub Actions**) publishes the entire site automatically!

---

## 2. Hard Invariants (Never Break)

- NEVER commit `.env` or API keys.
- NEVER modify `videolezioni/js/live-sync.js` or `videolezioni/css/*` unless fixing a genuine framework bug (and always re-run `npm run verify` on all chapters after).
- ALWAYS use `\gt` / `\lt` (never `&gt;` / `&lt;`) inside KaTeX `\htmlId{...}{...}`.
- Keep `slide_html` clean, scannable, and zero-scroll at `1280×800` (see `docs/AI_AUTHORING_SPEC.md`).
