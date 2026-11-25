#!/usr/bin/env python3
"""Helper guidato per configurare GEMINI_API_KEY in .env e stimare il costo audio del corso."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
ENV_PATH = REPO_ROOT / ".env"
LESSONS_DIR = REPO_ROOT / "videolezioni" / "lessons"

# Gemini TTS Batch API approximate cost (~0.85 EUR per hour of Italian speech, ~2.45 words/sec)
EUR_PER_HOUR_BATCH = 0.85


def load_env_key() -> str:
    if ENV_PATH.is_file():
        for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("GEMINI_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return os.environ.get("GEMINI_API_KEY", "").strip()


def save_env_key(api_key: str, budget_eur: float) -> None:
    lines = []
    if ENV_PATH.is_file():
        for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
            if not line.strip().startswith(("GEMINI_API_KEY=", "TTS_MAX_BUDGET_EUR=")):
                lines.append(line)
    lines.append(f"GEMINI_API_KEY={api_key.strip()}")
    lines.append(f"TTS_MAX_BUDGET_EUR={budget_eur:.2f}")
    ENV_PATH.write_text("\n".join(lines).strip() + "\n", encoding="utf-8")


def estimate_course_cost() -> tuple[int, int, float, float]:
    total_scenes = 0
    missing_audio = 0
    total_words = 0
    missing_words = 0
    for ljson in sorted(LESSONS_DIR.glob("*/lesson.json")):
        data = json.loads(ljson.read_text(encoding="utf-8"))
        for sc in data.get("scenes", []):
            total_scenes += 1
            w = len((sc.get("tts_text") or "").split())
            total_words += w
            af = ljson.parent / sc.get("audio_file", "")
            if not sc.get("audio_file") or not af.is_file():
                missing_audio += 1
                missing_words += w
    hours_total = total_words / (2.45 * 3600)
    hours_missing = missing_words / (2.45 * 3600)
    return total_scenes, missing_audio, hours_total, hours_missing * EUR_PER_HOUR_BATCH


def main() -> int:
    parser = argparse.ArgumentParser(description="Verifica/salva GEMINI_API_KEY in .env e stima costi TTS.")
    parser.add_argument("--set-key", help="Salva la GEMINI_API_KEY direttamente in .env")
    parser.add_argument("--budget", type=float, default=5.0, help="Tetto massimo di spesa in EUR (default: 5.0)")
    parser.add_argument("--check", action="store_true", help="Verifica solo stato chiave e stima costi")
    args = parser.parse_args()

    if args.set_key:
        save_env_key(args.set_key, args.budget)
        print(f"[OK] GEMINI_API_KEY salvata in .env (budget cap: {args.budget:.2f} EUR). File ignorato da git.")

    key = load_env_key()
    scenes, missing, hours, est_eur = estimate_course_cost()
    print(f"Stato GEMINI_API_KEY: {'CONFIGURATA' if key else 'NON CONFIGURATA (creala su https://aistudio.google.com/apikey)'}")
    print(f"Scene totali: {scenes} ({hours:.2f} ore) | Audio mancanti: {missing} | Stima Batch TTS: ~{est_eur:.2f} EUR")
    if not key and not args.check:
        print("\nOpzioni:")
        print("  1. Gemini TTS (consigliato, ~0.85 EUR/ora in batch): python videolezioni/scripts/setup_tts.py --set-key LA_TUA_KEY")
        print("  2. Edge TTS gratuito (zero API key): python videolezioni/scripts/generate_audio.py <slug> --provider edge")
    return 0


if __name__ == "__main__":
    sys.exit(main())
