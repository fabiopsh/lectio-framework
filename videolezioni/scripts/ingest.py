#!/usr/bin/env python3
"""Ingest course materials from sources/ (PDF, PPTX, LaTeX, Markdown, TXT) into compact text dumps.

Produces `sources/_extracted/<stem>.txt` and `sources/_extracted/index.json`
so any AI agent can build a course outline & lesson.json files using minimal tokens.
"""

from __future__ import annotations

import json
from pathlib import Path
import re
import sys

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
SOURCES_DIR = REPO_ROOT / "sources"
OUT_DIR = SOURCES_DIR / "_extracted"

SUPPORTED = {".pdf", ".pptx", ".tex", ".md", ".txt"}


def extract_pdf(path: Path) -> tuple[str, int]:
    try:
        import fitz  # PyMuPDF
    except ImportError:
        raise RuntimeError("PyMuPDF mancante: installa con `pip install pymupdf`.")
    doc = fitz.open(path)
    pages = []
    for i, page in enumerate(doc, 1):
        txt = page.get_text("text").strip()
        txt = re.sub(r"[ \t]+\n", "\n", txt)
        txt = re.sub(r"\n{3,}", "\n\n", txt)
        pages.append(f"--- PAGINA {i} ---\n{txt}")
    return "\n\n".join(pages), len(doc)


def extract_pptx(path: Path) -> tuple[str, int]:
    try:
        from pptx import Presentation
    except ImportError:
        raise RuntimeError("python-pptx mancante: installa con `pip install python-pptx`.")
    prs = Presentation(str(path))
    slides = []
    for i, slide in enumerate(prs.slides, 1):
        parts = []
        for shape in slide.shapes:
            if shape.has_text_frame:
                t = shape.text_frame.text.strip()
                if t:
                    parts.append(t)
            if shape.has_table:
                rows = [" | ".join(c.text.strip() for c in r.cells) for r in shape.table.rows]
                parts.append("\n".join(rows))
        if slide.has_notes_slide and slide.notes_slide.notes_text_frame:
            notes = slide.notes_slide.notes_text_frame.text.strip()
            if notes:
                parts.append(f"[Note relatore]: {notes}")
        slides.append(f"--- SLIDE {i} ---\n" + "\n".join(parts))
    return "\n\n".join(slides), len(prs.slides)


def extract_text(path: Path) -> tuple[str, int]:
    raw = path.read_text(encoding="utf-8", errors="replace").strip()
    lines = raw.splitlines()
    return raw, max(1, len(lines) // 45)


def main() -> int:
    if not SOURCES_DIR.is_dir():
        print("Cartella sources/ non trovata.")
        return 1

    files = sorted(
        p for p in SOURCES_DIR.rglob("*")
        if p.is_file()
        and p.suffix.lower() in SUPPORTED
        and "_extracted" not in p.parts
        and p.name.lower() != "readme.md"
    )

    if not files:
        print("Nessun file sorgente trovato in sources/ (supportati: .pdf, .pptx, .tex, .md, .txt).")
        print("Copia i tuoi PDF/slide dentro sources/ e rilancia lo script.")
        return 0

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    index = []
    for idx, src in enumerate(files, 1):
        rel = src.relative_to(SOURCES_DIR).as_posix()
        ext = src.suffix.lower()
        try:
            if ext == ".pdf":
                text, units = extract_pdf(src)
            elif ext == ".pptx":
                text, units = extract_pptx(src)
            else:
                text, units = extract_text(src)
        except Exception as exc:
            print(f"[ERR] {rel}: {exc}")
            continue

        safe_name = f"{idx:02d}-{re.sub(r'[^a-zA-Z0-9_-]+', '_', src.stem).strip('_')}.txt"
        out_path = OUT_DIR / safe_name
        out_path.write_text(text + "\n", encoding="utf-8")
        words = len(text.split())
        index.append({
            "source": rel,
            "extracted": f"sources/_extracted/{safe_name}",
            "type": ext.lstrip("."),
            "pages_or_slides": units,
            "words": words,
            "est_minutes": max(2, round(words / 145)),
        })
        print(f"[OK] {rel:42s} -> {safe_name} ({units} pag/slide, {words} parole)")

    (OUT_DIR / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    total_w = sum(x["words"] for x in index)
    print(f"\nEstratti {len(index)} file ({total_w:,} parole totali) in sources/_extracted/index.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
