# -*- coding: utf-8 -*-
"""把硅基员工素材拼成总览图，方便肉眼验收风格一致性。

用法：python3 contact-sheet.py <webp_dir> <manifest.json> <out.jpg> [cols]
"""
import json, os, sys
from PIL import Image, ImageDraw

src, manifest_path, out = sys.argv[1], sys.argv[2], sys.argv[3]
cols = int(sys.argv[4]) if len(sys.argv) > 4 else 8
manifest = json.load(open(manifest_path))

cell, pad, label_h = 150, 10, 22
rows = (len(manifest) + cols - 1) // cols
W = cols * (cell + pad) + pad
H = rows * (cell + pad + label_h) + pad
sheet = Image.new("RGB", (W, H), (250, 250, 252))
draw = ImageDraw.Draw(sheet)

for i, item in enumerate(manifest):
    slug = item["slug"]
    path = os.path.join(src, f"{slug}-face.webp")
    if not os.path.exists(path):
        path = os.path.join(src, f"{slug}.webp")
    if not os.path.exists(path):
        continue
    im = Image.open(path).convert("RGB").resize((cell, cell), Image.LANCZOS)
    r, c = divmod(i, cols)
    x = pad + c * (cell + pad)
    y = pad + r * (cell + pad + label_h)
    mask = Image.new("L", (cell, cell), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, cell - 1, cell - 1), fill=255)
    sheet.paste(im, (x, y), mask)
    draw.text((x + 4, y + cell + 4), f"{slug[:22]}", fill=(70, 70, 90))

sheet.save(out, quality=92)
print("wrote", out, sheet.size)
