#!/usr/bin/env python3
"""
Genera o assembla uno spritesheet 6-frame per l'avatar tutor personalizzato del corso
e aggiorna automaticamente `course.config.json`.

Ordine fisso dei 6 frame orizzontali (compatibile con `videolezioni/js/avatar.js`):
  0: idle        (occhi aperti, espressione neutra/calma)
  1: blink       (occhi chiusi)
  2: speak_mid   (bocca socchiusa — consonanti / i)
  3: speak_open  (bocca aperta — vocali a / e)
  4: speak_round (bocca arrotondata — vocali o / u)
  5: happy       (sorriso caldo)

Modalità d'uso:
  1) Elenca voci TTS disponibili (Gemini + Edge):
     python videolezioni/scripts/generate_avatar.py --list-voices

  2) Genera automaticamente i 6 frame con Gemini Image API (usa GEMINI_API_KEY in .env):
     python videolezioni/scripts/generate_avatar.py \
       --name "Marco" \
       --prompt "young Italian male university tutor with dark curly hair, glasses, navy sweater, warm studio pixel-art bust portrait" \
       --voice Orus

  3) Assembla 6 immagini già generate (es. da tool AI nativo come Antigravity image-generator):
     python videolezioni/scripts/generate_avatar.py \
       --name "Marco" \
       --from-dir path/to/frames/ \
       --voice Orus
"""

from __future__ import annotations

import argparse
from collections import deque
from io import BytesIO
import json
import os
from pathlib import Path
import re
import sys

from PIL import Image

SCRIPT_DIR = Path(__file__).resolve().parent
VIDEOLEZIONI_DIR = SCRIPT_DIR.parent
REPO_ROOT = VIDEOLEZIONI_DIR.parent
ASSETS_DIR = VIDEOLEZIONI_DIR / "assets"
CONFIG_PATH = REPO_ROOT / "course.config.json"

FRAME_SPECS = [
    ("0_idle", "calm neutral expression, eyes open looking at viewer, mouth gently closed"),
    ("1_blink", "eyes softly closed in a natural blink, mouth gently closed, exact same head/hair/clothes/pose"),
    ("2_speak_mid", "eyes open, mouth slightly open speaking a soft consonant/i sound, exact same head/hair/clothes/pose"),
    ("3_speak_open", "eyes open, mouth clearly open speaking an 'ah/eh' vowel sound, exact same head/hair/clothes/pose"),
    ("4_speak_round", "eyes open, mouth rounded in a small 'oh/oo' vowel shape, exact same head/hair/clothes/pose"),
    ("5_happy", "warm friendly smile, eyes bright and cheerful, exact same head/hair/clothes/pose"),
]

GEMINI_VOICES = [
    ("Kore", "Femminile (default Lia)", "Chiara, decisa, didattica e naturale"),
    ("Aoede", "Femminile", "Calda, espressiva, scorrevole"),
    ("Leda", "Femminile", "Giovane, brillante, amichevole"),
    ("Zephyr", "Femminile", "Leggera, ariosa, pacata"),
    ("Orus", "Maschile", "Autorevole, chiara, stile docente"),
    ("Charon", "Maschile", "Profonda, calma, informativa"),
    ("Fenrir", "Maschile", "Energica, coinvolgente, chiara"),
    ("Puck", "Maschile", "Vivace, divulgativa, colloquiale"),
]

EDGE_VOICES = [
    ("it-IT-ElsaNeural", "Italiano · Femminile (default Edge)"),
    ("it-IT-IsabellaNeural", "Italiano · Femminile (calda)"),
    ("it-IT-DiegoNeural", "Italiano · Maschile"),
    ("en-US-AriaNeural", "English · Female"),
    ("en-US-GuyNeural", "English · Male"),
]


def load_dotenv_files() -> None:
    for env_path in (VIDEOLEZIONI_DIR / ".env", REPO_ROOT / ".env"):
        if not env_path.is_file():
            continue
        for raw_line in env_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k = k.strip()
            v = v.strip().strip('"').strip("'")
            if k and k not in os.environ:
                os.environ[k] = v


def slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")
    return s or "tutor"


def print_voices() -> None:
    print("=== Voci Gemini TTS (consigliate — naturali, multilingua IT/EN) ===")
    for v, gender, desc in GEMINI_VOICES:
        print(f"  - {v:<10} | {gender:<24} | {desc}")
    print("\n=== Voci Edge TTS (gratuite, zero API key) ===")
    for v, desc in EDGE_VOICES:
        print(f"  - {v:<22} | {desc}")
    print("\nImposta la voce in `course.config.json` -> `tts.voice_name` (o `tts.edge_voice`), oppure passa `--voice <Nome>`.")


def remove_solid_background(img: Image.Image, tolerance: int = 38) -> Image.Image:
    """Rimuove lo sfondo uniforme connesso ai bordi tramite flood-fill RGB (preserva il soggetto interno)."""
    rgba = img.convert("RGBA")
    w, h = rgba.size
    px = rgba.load()

    # Se l'immagine ha già trasparenza significativa sui bordi, non toccarla
    border_samples = [
        px[0, 0], px[w - 1, 0], px[0, h - 1], px[w - 1, h - 1],
        px[w // 2, 0], px[0, h // 2], px[w - 1, h // 2],
    ]
    if sum(1 for c in border_samples if c[3] < 32) >= 4:
        return rgba

    # Colore di riferimento dello sfondo = mediana dei 4 angoli
    corners = [px[1, 1], px[w - 2, 1], px[1, h - 2], px[w - 2, h - 2]]
    bg_r = sorted(c[0] for c in corners)[1]
    bg_g = sorted(c[1] for c in corners)[1]
    bg_b = sorted(c[2] for c in corners)[1]

    def is_bg(r: int, g: int, b: int, a: int) -> bool:
        if a < 16:
            return True
        return abs(r - bg_r) <= tolerance and abs(g - bg_g) <= tolerance and abs(b - bg_b) <= tolerance

    visited = bytearray(w * h)
    q: deque[tuple[int, int]] = deque()
    for x in range(w):
        q.append((x, 0))
        q.append((x, h - 1))
    for y in range(h):
        q.append((0, y))
        q.append((w - 1, y))

    while q:
        x, y = q.popleft()
        idx = y * w + x
        if visited[idx]:
            continue
        visited[idx] = 1
        r, g, b, a = px[x, y]
        if not is_bg(r, g, b, a):
            continue
        px[x, y] = (0, 0, 0, 0)
        if x > 0:
            q.append((x - 1, y))
        if x + 1 < w:
            q.append((x + 1, y))
        if y > 0:
            q.append((x, y - 1))
        if y + 1 < h:
            q.append((x, y + 1))

    return rgba


def fit_frame_square(img: Image.Image, size: int = 256) -> Image.Image:
    """Centra il busto del tutor in un riquadro size x size appoggiato al bordo inferiore."""
    cleaned = remove_solid_background(img)
    bbox = cleaned.getbbox()
    if not bbox:
        return cleaned.resize((size, size), Image.LANCZOS)
    cropped = cleaned.crop(bbox)
    cw, ch = cropped.size
    pad_top = int(size * 0.05)
    target_h = size - pad_top
    target_w = int(size * 0.92)
    scale = min(target_w / max(1, cw), target_h / max(1, ch))
    nw = max(1, int(round(cw * scale)))
    nh = max(1, int(round(ch * scale)))
    resized = cropped.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ox = (size - nw) // 2
    oy = size - nh
    canvas.paste(resized, (ox, oy), resized)
    return canvas


def load_frames_from_dir(frames_dir: Path) -> list[Image.Image]:
    """Carica 6 frame da una cartella cercando prima i nomi standard (0_idle..5_happy), poi ordine alfabetico."""
    if not frames_dir.is_dir():
        raise SystemExit(f"Cartella non trovata: {frames_dir}")

    exts = {".png", ".jpg", ".jpeg", ".webp"}
    files = [p for p in sorted(frames_dir.iterdir()) if p.is_file() and p.suffix.lower() in exts]
    if len(files) < 6:
        raise SystemExit(f"Servono almeno 6 immagini in {frames_dir} (trovate {len(files)}).")

    by_stem = {p.stem.lower(): p for p in files}
    ordered: list[Path] = []
    for key, _ in FRAME_SPECS:
        short = key.split("_", 1)[1]
        match = next((p for s, p in by_stem.items() if key in s or short in s), None)
        if match and match not in ordered:
            ordered.append(match)

    if len(ordered) != 6:
        ordered = files[:6]

    print("Frame caricati in ordine (idle, blink, mid, open, round, happy):")
    for idx, p in enumerate(ordered):
        print(f"  [{idx}] {p.name}")
    return [Image.open(p).convert("RGBA") for p in ordered]


def generate_frames_via_gemini(prompt_desc: str, model: str) -> list[Image.Image]:
    """Genera 6 frame consistenti (1 base + 5 edit bocca/occhi) usando Gemini Image API."""
    load_dotenv_files()
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise SystemExit(
            "GEMINI_API_KEY non trovata in .env.\n"
            "Configurala con `python videolezioni/scripts/setup_tts.py --set-key LA_TUA_CHIAVE` "
            "oppure genera 6 immagini col tool nativo del tuo AI harness e usa `--from-dir`."
        )
    try:
        from google import genai
        from google.genai import types
    except ImportError:
        raise SystemExit("Pacchetto `google-genai` mancante. Installa con: pip install google-genai")

    client = genai.Client(api_key=api_key)

    def extract_image(resp) -> Image.Image:
        for cand in getattr(resp, "candidates", []) or []:
            for part in getattr(cand.content, "parts", []) or []:
                inline = getattr(part, "inline_data", None)
                if inline and getattr(inline, "data", None):
                    return Image.open(BytesIO(inline.data)).convert("RGBA")
        raise RuntimeError("Nessuna immagine restituita dal modello Gemini.")

    base_prompt = (
        f"Front-facing bust portrait of a friendly course tutor: {prompt_desc}. "
        f"Style: crisp modern 16-bit illustrated pixel-art portrait, clean dark outline, warm soft lighting, "
        f"centered shoulders and head, isolated on a completely flat pure solid white (#FFFFFF) background, "
        f"no text, no border, no frame, no props. Expression: {FRAME_SPECS[0][1]}."
    )
    print(f"[1/6] Generazione frame base (idle) con {model}...")
    resp0 = client.models.generate_content(
        model=model,
        contents=[base_prompt],
        config=types.GenerateContentConfig(response_modalities=["IMAGE"]),
    )
    base_img = extract_image(resp0)
    frames = [base_img]

    for idx, (label, expr) in enumerate(FRAME_SPECS[1:], start=2):
        edit_prompt = (
            f"Edit ONLY the eyes and/or mouth of this exact character portrait so the expression is: {expr}. "
            "Keep the head position, hair, face shape, glasses, clothing, pixel-art style, scale, lighting, "
            "and pure flat solid white (#FFFFFF) background 100% identical pixel-for-pixel."
        )
        print(f"[{idx}/6] Generazione frame {label}...")
        resp = client.models.generate_content(
            model=model,
            contents=[edit_prompt, base_img],
            config=types.GenerateContentConfig(response_modalities=["IMAGE"]),
        )
        frames.append(extract_image(resp))

    return frames


def update_course_config(
    name: str | None,
    spritesheet_rel: str | None,
    description: str | None,
    voice: str | None,
    edge_voice: str | None,
) -> None:
    if not CONFIG_PATH.is_file():
        return
    cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    ta = cfg.setdefault("tutor_avatar", {})
    ta["enabled"] = True
    if name:
        ta["name"] = name
    if spritesheet_rel:
        ta["spritesheet"] = spritesheet_rel
    if description:
        ta["description"] = description

    tts = cfg.setdefault("tts", {})
    if voice:
        tts["voice_name"] = voice
    if edge_voice:
        tts["edge_voice"] = edge_voice

    CONFIG_PATH.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Aggiornato {CONFIG_PATH.relative_to(REPO_ROOT)}!")


def main() -> int:
    parser = argparse.ArgumentParser(description="Genera o assembla un avatar tutor custom (spritesheet 6-frame).")
    parser.add_argument("--list-voices", action="store_true", help="Mostra le voci Gemini e Edge TTS disponibili.")
    parser.add_argument("--name", default=None, help="Nome del tutor personalizzato (es. Marco, Ada, Prof. Nova).")
    parser.add_argument("--prompt", default=None, help="Descrizione fisica/stile per generare i 6 frame via Gemini Image API.")
    parser.add_argument("--from-dir", default=None, help="Cartella con 6 frame già pronti (idle, blink, speak_mid, speak_open, speak_round, happy).")
    parser.add_argument("--voice", default=None, help="Voce Gemini TTS da salvare in course.config.json (es. Orus, Charon, Aoede, Kore).")
    parser.add_argument("--edge-voice", default=None, help="Voce Edge TTS da salvare in course.config.json (es. it-IT-DiegoNeural).")
    parser.add_argument("--frame-size", type=int, default=256, help="Dimensione quadrata di ciascun frame in px (default: 256).")
    parser.add_argument("--model", default="gemini-2.5-flash-image", help="Modello Gemini per generazione immagini (default: gemini-2.5-flash-image).")
    parser.add_argument("--no-config-update", action="store_true", help="Non aggiornare automaticamente course.config.json.")
    args = parser.parse_args()

    if args.list_voices:
        print_voices()
        return 0

    # Solo cambio nome/voce senza rigenerare spritesheet
    if not args.prompt and not args.from_dir:
        if args.name or args.voice or args.edge_voice:
            if not args.no_config_update:
                update_course_config(args.name, None, None, args.voice, args.edge_voice)
            return 0
        parser.print_help()
        return 1

    tutor_name = (args.name or "Tutor").strip()
    slug = slugify(tutor_name)
    size = max(128, args.frame_size)

    if args.from_dir:
        raw_frames = load_frames_from_dir(Path(args.from_dir).resolve())
    else:
        raw_frames = generate_frames_via_gemini(args.prompt, args.model)

    fitted = [fit_frame_square(f, size=size) for f in raw_frames]

    sheet = Image.new("RGBA", (size * 6, size), (0, 0, 0, 0))
    for i, fr in enumerate(fitted):
        sheet.paste(fr, (i * size, 0), fr)

    ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    sheet_filename = f"{slug}-spritesheet.png"
    sheet_path = ASSETS_DIR / sheet_filename
    sheet.save(sheet_path, format="PNG", optimize=True)
    print(f"Salvato spritesheet 6-frame ({size * 6}x{size}): videolezioni/assets/{sheet_filename}")

    if not args.no_config_update:
        update_course_config(
            name=tutor_name,
            spritesheet_rel=f"assets/{sheet_filename}",
            description=args.prompt,
            voice=args.voice,
            edge_voice=args.edge_voice,
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
