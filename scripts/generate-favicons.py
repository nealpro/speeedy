"""Generate raster favicon assets from public/favicon.svg."""

from __future__ import annotations

import io
from pathlib import Path

import cairosvg
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
SVG = PUBLIC / "favicon.svg"

SIZES = {
    "favicon-48.png": 48,
    "apple-touch-icon.png": 180,
    "icon-192.png": 192,
    "icon-512.png": 512,
}


def render_png(size: int) -> Image.Image:
    png_bytes = cairosvg.svg2png(
        bytestring=SVG.read_bytes(),
        output_width=size,
        output_height=size,
    )
    return Image.open(io.BytesIO(png_bytes))


def main() -> None:
    for name, size in SIZES.items():
        render_png(size).save(PUBLIC / name, format="PNG", optimize=True)

    render_png(32).save(PUBLIC / "favicon.ico", format="ICO", sizes=[(32, 32)])
    print("Generated favicon assets in public/")


if __name__ == "__main__":
    main()
