from pathlib import Path
from PIL import Image, ImageOps, ImageDraw

raw = Path('outputs/remaining-visuals-raw')
root = Path('web/public/assets')
groups = {
    'carbon-defaults': ([f'carbon-{i:02d}.png' for i in range(1, 25)], 256, 'webp', 88),
    'capabilities/categories': ([
        'category-technology.png', 'category-product-design.png', 'category-marketing-growth.png',
        'category-ecommerce.png', 'category-sales-customer.png', 'category-operations-org.png',
        'category-finance-legal.png'], 512, 'webp', 88),
    'capabilities/types': (['type-agent.png', 'type-rpa.png', 'type-skill.png', 'type-ai-app.png'], 256, 'webp', 88),
    'capabilities/featured': ([
        'featured-code-review.png', 'featured-meeting-notes.png', 'featured-content-strategy.png',
        'featured-ecommerce-ads.png', 'featured-knowledge-rag.png', 'featured-workflow-rpa.png',
        'featured-data-analysis.png', 'featured-customer-support.png'], 1536, 'webp', 86),
    'marketing/hero': (['desktop.png', 'mobile.png'], None, 'webp', 86),
}

for folder, (names, max_dim, fmt, quality) in groups.items():
    out_dir = root / folder
    out_dir.mkdir(parents=True, exist_ok=True)
    for name in names:
        source = raw / name
        target = out_dir / (Path(name).stem + '.webp')
        with Image.open(source) as im:
            im = im.convert('RGB')
            if max_dim:
                scale = min(1, max_dim / max(im.size))
                size = (round(im.width * scale), round(im.height * scale))
                if size != im.size:
                    im = im.resize(size, Image.Resampling.LANCZOS)
            im.save(target, 'WEBP', quality=quality, method=6)

def sheet(prefixes, out, columns, thumb):
    files = []
    for prefix in prefixes:
        files.extend(sorted(raw.glob(prefix)))
    rows = (len(files) + columns - 1) // columns
    cell_w, cell_h = thumb + 12, thumb + 38
    canvas = Image.new('RGB', (columns * cell_w, rows * cell_h), '#eef0f5')
    draw = ImageDraw.Draw(canvas)
    for idx, f in enumerate(files):
        with Image.open(f) as im:
            im.thumbnail((thumb, thumb), Image.Resampling.LANCZOS)
            x = (idx % columns) * cell_w + (cell_w - im.width) // 2
            y = (idx // columns) * cell_h + 4
            canvas.paste(im.convert('RGB'), (x, y))
            draw.text(((idx % columns) * cell_w + 4, y + thumb + 6), f.stem[:22], fill='#273044')
    canvas.save(out, 'JPEG', quality=90, optimize=True)

sheet(['carbon-*.png'], 'outputs/carbon-defaults-contact-sheet.jpg', 6, 180)
sheet(['category-*.png', 'type-*.png'], 'outputs/capabilities-contact-sheet.jpg', 4, 220)
sheet(['featured-*.png', 'desktop.png', 'mobile.png'], 'outputs/featured-hero-contact-sheet.jpg', 3, 260)
print('processed', sum(len(x[0]) for x in groups.values()), 'assets')
