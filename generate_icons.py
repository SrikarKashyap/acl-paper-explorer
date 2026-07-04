"""One-off script to generate PWA icons for the app (static/icons/)."""
import os
from PIL import Image, ImageDraw, ImageFont

os.makedirs("static/icons", exist_ok=True)

SIZE = 512
img = Image.new("RGB", (SIZE, SIZE))
draw = ImageDraw.Draw(img)

# Diagonal gradient from purple (#8b5cf6) to blue (#3b82f6)
c1 = (139, 92, 246)
c2 = (59, 130, 246)
for y in range(SIZE):
    for_ratio_row = y / (SIZE - 1)
    for x in range(0, SIZE, SIZE):
        pass
    # Draw one horizontal line per row with interpolated color (diagonal feel via row+col mix)
for y in range(SIZE):
    t = y / (SIZE - 1)
    r = int(c1[0] + (c2[0] - c1[0]) * t)
    g = int(c1[1] + (c2[1] - c1[1]) * t)
    b = int(c1[2] + (c2[2] - c1[2]) * t)
    draw.line([(0, y), (SIZE, y)], fill=(r, g, b))

# Text: "ACL" big, "2026" below
def load_font(size):
    for name in ["seguisb.ttf", "segoeuib.ttf", "arialbd.ttf", "arial.ttf"]:
        try:
            return ImageFont.truetype(os.path.join("C:\\Windows\\Fonts", name), size)
        except OSError:
            continue
    return ImageFont.load_default()

font_big = load_font(190)
font_small = load_font(96)

def draw_centered(text, font, cy):
    bbox = draw.textbbox((0, 0), text, font=font)
    w = bbox[2] - bbox[0]
    h = bbox[3] - bbox[1]
    draw.text(((SIZE - w) / 2 - bbox[0], cy - h / 2 - bbox[1]), text, font=font, fill="white")

draw_centered("ACL", font_big, 215)
draw_centered("2026", font_small, 370)

# Rounded corners via alpha mask
mask = Image.new("L", (SIZE, SIZE), 0)
mask_draw = ImageDraw.Draw(mask)
mask_draw.rounded_rectangle([0, 0, SIZE, SIZE], radius=96, fill=255)
rounded = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
rounded.paste(img, (0, 0), mask)

rounded.save("static/icons/icon-512.png")
rounded.resize((192, 192), Image.LANCZOS).save("static/icons/icon-192.png")
# Apple touch icon: square (iOS applies its own corner rounding)
img.resize((180, 180), Image.LANCZOS).save("static/icons/apple-touch-icon.png")
img.resize((32, 32), Image.LANCZOS).save("static/icons/favicon-32.png")

print("Icons written to static/icons/")
