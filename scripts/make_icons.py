#!/usr/bin/env python3
"""Write simple PNG app icons (no third-party deps)."""

from __future__ import annotations

import struct
import zlib
from pathlib import Path


def chunk(tag: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def write_png(path: Path, width: int, height: int, rgba_fn) -> None:
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        for x in range(width):
            raw.extend(rgba_fn(x, y, width, height))
    png = b"".join(
        [
            b"\x89PNG\r\n\x1a\n",
            chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)),
            chunk(b"IDAT", zlib.compress(bytes(raw), 9)),
            chunk(b"IEND", b""),
        ]
    )
    path.write_bytes(png)


def lerp(a: int, b: int, t: float) -> int:
    return int(a + (b - a) * t)


def pixel(x: int, y: int, w: int, h: int) -> bytes:
    nx = (x + 0.5) / w
    ny = (y + 0.5) / h
    dx = nx - 0.5
    dy = ny - 0.52
    r = (dx * dx + dy * dy) ** 0.5

    bg = (18, 16, 14, 255)
    disc = (36, 30, 24, 255)
    gold = (232, 184, 109, 255)
    cream = (244, 238, 230, 255)

    if r > 0.46:
        return bytes(bg)
    if r > 0.40:
        return bytes(disc)

    # stylized scale pan
    body = abs(ny - 0.58) < 0.045 and 0.28 < nx < 0.72
    stem = abs(nx - 0.5) < 0.035 and 0.28 < ny < 0.58
    top = abs(ny - 0.30) < 0.03 and 0.36 < nx < 0.64
    # two ear-like dots
    left = ((nx - 0.34) ** 2 + (ny - 0.42) ** 2) ** 0.5 < 0.055
    right = ((nx - 0.66) ** 2 + (ny - 0.42) ** 2) ** 0.5 < 0.055

    if body or stem or top:
        t = 0.15 + ny * 0.4
        return bytes(
            (
                lerp(gold[0], cream[0], t),
                lerp(gold[1], cream[1], t),
                lerp(gold[2], cream[2], t),
                255,
            )
        )
    if left or right:
        return bytes(gold)
    return bytes(disc)


def main() -> None:
    root = Path(__file__).resolve().parents[1] / "src-tauri" / "icons"
    root.mkdir(parents=True, exist_ok=True)
    for name, size in [("32x32.png", 32), ("128x128.png", 128), ("128x128@2x.png", 256), ("icon.png", 512)]:
        write_png(root / name, size, size, pixel)
    print(f"wrote icons in {root}")


if __name__ == "__main__":
    main()
