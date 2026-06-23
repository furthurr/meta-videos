#!/usr/bin/env python3
"""Genera los iconos base 16/48/128 con un diseno simple (play + 4 puntos)."""
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "icons")
os.makedirs(OUT, exist_ok=True)

BG = (90, 60, 230, 255)        # morado Meta-ish
FG = (255, 255, 255, 255)
ACCENT = (0, 200, 255, 255)

def make(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # fondo redondeado
    r = max(2, size // 6)
    d.rounded_rectangle((0, 0, size - 1, size - 1), radius=r, fill=BG)
    # 4 cuadritos (los 4 videos)
    pad = size * 0.18
    cell = (size - pad * 2) / 2
    gap = size * 0.08
    for r in range(2):
        for c in range(2):
            x0 = pad + c * (cell + gap)
            y0 = pad + r * (cell + gap)
            d.rounded_rectangle(
                (x0, y0, x0 + cell, y0 + cell),
                radius=max(1, size // 16),
                fill=FG,
            )
            # play dentro
            cx = x0 + cell * 0.5
            cy = y0 + cell * 0.55
            s = cell * 0.28
            d.polygon(
                [
                    (cx - s * 0.45, cy - s * 0.7),
                    (cx - s * 0.45, cy + s * 0.7),
                    (cx + s * 0.7, cy),
                ],
                fill=BG,
            )
    return img

for s in (16, 48, 128):
    p = os.path.join(OUT, f"icon{s}.png")
    make(s).save(p)
    print("ok", p)
