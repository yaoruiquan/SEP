# -*- coding: utf-8 -*-
"""把硅基员工母版 PNG 派生为线上用的 WebP。

每位员工产出 3 个文件：
  <slug>.webp        512px 完整半身（详情页、身份区，保留服装和姿态）
  <slug>-face.webp   256px 头部特写（圆形头像，32-96px 下也能认清人）
  <slug>-full.webp   128px 备用小尺寸完整版（列表密集场景）

取景口径与前端 Avatar 组件保持一致：完整版直接缩放；
特写版取画布 25%-75% 宽、0%-50% 高，正好覆盖头部到胸口。

用法：python3 derive-silicon-webp.py <src_png_dir> <manifest.json> <out_dir>
"""
import json, os, sys
from PIL import Image

src_dir, manifest_path, out_dir = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(out_dir, exist_ok=True)
manifest = json.load(open(manifest_path))

written, missing = [], []
for item in manifest:
    slug = item["slug"]
    src = os.path.join(src_dir, item["file"])
    if not os.path.exists(src):
        missing.append(slug)
        continue
    try:
        im = Image.open(src).convert("RGB")
    except Exception:
        missing.append(slug)
        continue

    W, H = im.size
    face = im.crop((int(0.25 * W), 0, int(0.75 * W), int(0.50 * H)))

    targets = [
        (im, 512, f"{slug}.webp", 86),
        (face, 256, f"{slug}-face.webp", 88),
        (im, 128, f"{slug}-full.webp", 84),
    ]
    for source, size, name, quality in targets:
        path = os.path.join(out_dir, name)
        source.resize((size, size), Image.LANCZOS).save(path, "WEBP", quality=quality, method=6)
        written.append(path)

print(f"derived {len(written)} webp from {len(manifest) - len(missing)} masters, missing {len(missing)}")
if missing:
    print("missing:", ", ".join(missing))
