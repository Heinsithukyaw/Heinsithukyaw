#!/usr/bin/env python3
"""Builds assets/avatar.png — circular crop with a gradient ring.

GitHub strips `style`/`border-radius` from README HTML, so the ring has to be
baked into the image itself.

    python3 scripts/make-avatar.py [--source URL_OR_PATH] [--out PATH]
"""
from __future__ import annotations

import argparse
import io
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent

# ring gradient endpoints — deep navy -> accent blue -> light ice
RING_A = (29, 79, 125)     # #1D4F7D
RING_B = (90, 168, 221)    # #5AA8DD
RING_C = (159, 212, 245)   # #9FD4F5
BG = (10, 25, 41)          # #0A1929


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def ring_color(t: float):
    """t in [0,1) around the circle."""
    if t < 0.5:
        return lerp(RING_A, RING_B, t / 0.5)
    return lerp(RING_B, RING_C, (t - 0.5) / 0.5)


def load(src: str) -> Image.Image:
    if src.startswith(("http://", "https://")):
        req = urllib.request.Request(src, headers={"User-Agent": "avatar-builder"})
        with urllib.request.urlopen(req, timeout=45) as r:
            raw = r.read()
        return Image.open(io.BytesIO(raw)).convert("RGBA")
    return Image.open(src).convert("RGBA")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default="https://avatars.githubusercontent.com/u/56247368?v=4")
    ap.add_argument("--out", default=str(ROOT / "assets" / "avatar.png"))
    ap.add_argument("--size", type=int, default=460)
    args = ap.parse_args()

    S = args.size
    SS = 4  # supersample for clean edges
    canvas = Image.new("RGBA", (S * SS, S * SS), (0, 0, 0, 0))

    ring_w = int(S * 0.030) * SS
    pad = int(S * 0.035) * SS
    outer_r = S * SS // 2 - SS

    # gradient ring, drawn as many short arcs (PIL arcs share one bounding box)
    steps = 1440
    box = [SS, SS, S * SS - SS, S * SS - SS]
    for i in range(steps):
        t = i / steps
        start = (t * 360) - 90
        end = start + (360 / steps) + 0.6  # slight overlap kills seams
        ImageDraw.Draw(canvas).arc(box, start=start, end=end,
                                   fill=ring_color(t) + (255,), width=ring_w)

    # avatar
    avatar_r = outer_r - ring_w - pad
    d = avatar_r * 2
    src = load(args.source)
    w, h = src.size
    side = min(w, h)
    src = src.crop(((w - side) // 2, (h - side) // 2, (w + side) // 2, (h + side) // 2))
    src = src.resize((d, d), Image.LANCZOS)

    mask = Image.new("L", (d, d), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, d - 1, d - 1], fill=255)

    # thin dark gap ring between avatar and gradient ring
    gap = Image.new("RGBA", (S * SS, S * SS), (0, 0, 0, 0))
    ImageDraw.Draw(gap).ellipse(
        [SS + ring_w, SS + ring_w, S * SS - SS - ring_w, S * SS - SS - ring_w],
        fill=BG + (255,),
    )
    canvas = Image.alpha_composite(gap, canvas)

    cx = cy = S * SS // 2
    canvas.paste(src, (cx - avatar_r, cy - avatar_r), mask)

    canvas = canvas.resize((S, S), Image.LANCZOS)
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    canvas.save(args.out, "PNG", optimize=True)
    print(f"✓ {args.out}  ({S}x{S}, {Path(args.out).stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
