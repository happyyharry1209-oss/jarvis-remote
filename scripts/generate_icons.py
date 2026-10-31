from pathlib import Path
from PIL import Image, ImageDraw


OUT = Path(__file__).resolve().parent.parent / "icons"


def draw_icon(size: int) -> Image.Image:
    image = Image.new("RGBA", (size, size), (7, 9, 15, 255))
    draw = ImageDraw.Draw(image)
    center = size / 2
    cyan = (108, 115, 255, 255)
    soft = (29, 37, 64, 255)
    outer = int(size * 0.39)
    inner = int(size * 0.27)
    line = max(3, size // 42)
    draw.ellipse(
        (center - outer, center - outer, center + outer, center + outer),
        outline=cyan,
        width=line,
    )
    draw.ellipse(
        (center - inner, center - inner, center + inner, center + inner),
        fill=soft,
        outline=(88, 99, 170, 255),
        width=max(2, line // 2),
    )
    for angle in range(0, 360, 60):
        from math import cos, radians, sin
        r1 = size * 0.10
        r2 = size * 0.22
        a = radians(angle)
        draw.line(
            (
                center + cos(a) * r1,
                center + sin(a) * r1,
                center + cos(a) * r2,
                center + sin(a) * r2,
            ),
            fill=cyan,
            width=max(2, size // 70),
        )
    glow = int(size * 0.055)
    draw.ellipse(
        (center - glow, center - glow, center + glow, center + glow),
        fill=(230, 238, 255, 255),
    )
    return image


OUT.mkdir(parents=True, exist_ok=True)
for filename, size in (
    ("icon-192.png", 192),
    ("icon-512.png", 512),
    ("apple-touch-icon.png", 180),
):
    draw_icon(size).save(OUT / filename, optimize=True)
