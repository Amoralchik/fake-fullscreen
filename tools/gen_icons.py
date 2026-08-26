#!/usr/bin/env python3
"""
Generate the extension's placeholder icons — no dependencies.

Design: rounded indigo-gradient square, four white "theater" corner
brackets and a white play triangle. Shapes are tested analytically per
subsampled pixel, so the output is crisp at every size.

Usage:  python3 tools/gen_icons.py
Output: icons/icon-16.png, icon-32.png, icon-48.png, icon-128.png
"""

import math
import os
import struct
import zlib

SS = 4          # supersampling factor (4x4 samples per pixel)
CANVAS = 128.0  # all shape coordinates live in this space

# Palette: indigo gradient like the options-page accent.
TOP_COLOR = (99, 102, 241)     # #6366F1
BOTTOM_COLOR = (67, 56, 202)   # #4338CA
WHITE = (255, 255, 255)


# ---------------------------------------------------------------------
# Shape predicates (coordinates in [0, CANVAS], y grows downward)
# ---------------------------------------------------------------------

def inside_rounded_bg(x: float, y: float) -> bool:
    """Full-canvas rounded square with a small margin."""
    half = CANVAS / 2 - 3
    r = 30.0
    cx = cy = CANVAS / 2
    qx = abs(x - cx) - (half - r)
    qy = abs(y - cy) - (half - r)
    ax, ay = max(qx, 0.0), max(qy, 0.0)
    dist = min(max(qx, qy), 0.0) + math.hypot(ax, ay) - r
    return dist <= 0


def _corner_brackets():
    """Four L-shaped brackets as axis-aligned rects (x0,x1,y0,y1)."""
    m, arm, t = 16.0, 26.0, 10.0
    rects = []
    for cx, cy, dx, dy in (
        (m, m, +1, +1),                       # top-left
        (CANVAS - m, m, -1, +1),              # top-right
        (m, CANVAS - m, +1, -1),              # bottom-left
        (CANVAS - m, CANVAS - m, -1, -1),     # bottom-right
    ):
        rects.append((min(cx, cx + dx * arm), max(cx, cx + dx * arm),
                      min(cy, cy + dy * t), max(cy, cy + dy * t)))       # horizontal bar
        rects.append((min(cx, cx + dx * t), max(cx, cx + dx * t),
                      min(cy + dy * t, cy + dy * arm), max(cy + dy * t, cy + dy * arm)))
    return rects


BRACKETS = _corner_brackets()

TRIANGLE = ((52.0, 42.0), (52.0, 86.0), (90.0, 64.0))  # points right


def inside_brackets(x: float, y: float) -> bool:
    return any(x0 <= x <= x1 and y0 <= y <= y1 for x0, x1, y0, y1 in BRACKETS)


def inside_triangle(x: float, y: float) -> bool:
    """Consistent-sign cross products == inside (works for CW/CCW)."""
    signs = []
    pts = TRIANGLE
    for i in range(3):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % 3]
        cross = (x1 - x0) * (y - y0) - (y1 - y0) * (x - x0)
        if abs(cross) < 1e-9:
            return True  # on an edge
        signs.append(cross > 0)
    return all(s == signs[0] for s in signs)


# ---------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------

def render(size: int) -> bytes:
    scale = CANVAS / size
    buf = bytearray(size * size * 4)

    def to_canvas(px: float, py: float) -> tuple:
        return px * scale, py * scale

    for py in range(size):
        for px in range(size):
            ar = ag = ab = aa = 0.0
            for sy in range(SS):
                for sx in range(SS):
                    x, y = to_canvas(px + (sx + 0.5) / SS, py + (sy + 0.5) / SS)
                    col = (0.0, 0.0, 0.0, 0.0)
                    if inside_rounded_bg(x, y):
                        t = min(max(y / CANVAS, 0.0), 1.0)
                        r = TOP_COLOR[0] + (BOTTOM_COLOR[0] - TOP_COLOR[0]) * t
                        g = TOP_COLOR[1] + (BOTTOM_COLOR[1] - TOP_COLOR[1]) * t
                        b = TOP_COLOR[2] + (BOTTOM_COLOR[2] - TOP_COLOR[2]) * t
                        col = (r, g, b, 255.0)
                        if inside_brackets(x, y) or inside_triangle(x, y):
                            col = (*WHITE, 255.0)
                    ar += col[0]; ag += col[1]; ab += col[2]; aa += col[3]
            n = SS * SS
            i = (py * size + px) * 4
            buf[i]     = round(ar / n)
            buf[i + 1] = round(ag / n)
            buf[i + 2] = round(ab / n)
            buf[i + 3] = round(aa / n)
    return bytes(buf)


def write_png(path: str, size: int, rgba: bytes) -> None:
    def chunk(tag: bytes, data: bytes) -> bytes:
        return (struct.pack('>I', len(data)) + tag + data +
                struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF))

    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)  # 8-bit RGBA
    stride = size * 4
    raw = b''.join(b'\x00' + rgba[y * stride:(y + 1) * stride]
                   for y in range(size))
    png = (b'\x89PNG\r\n\x1a\n' +
           chunk(b'IHDR', ihdr) +
           chunk(b'IDAT', zlib.compress(raw, 9)) +
           chunk(b'IEND', b''))
    with open(path, 'wb') as f:
        f.write(png)


def main() -> None:
    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                           os.pardir, 'icons')
    out_dir = os.path.normpath(out_dir)
    os.makedirs(out_dir, exist_ok=True)

    for size in (16, 32, 48, 128):
        path = os.path.join(out_dir, f'icon-{size}.png')
        write_png(path, size, render(size))
        print(f'wrote {path}')


if __name__ == '__main__':
    main()
