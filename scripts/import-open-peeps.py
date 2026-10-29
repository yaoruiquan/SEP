"""Import the publicly downloadable CC0 Open Peeps SVG packs and head crops.

Run explicitly when updating the source pack; normal builds never access the network.
"""
import concurrent.futures
import hashlib
import json
import re
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEST = ROOT / 'web/public/assets/avatar-libraries/open-peeps'
MANIFEST = ROOT / 'backend/src/shared/open-peeps-assets.json'
SOURCE = 'https://www.openpeeps.com/'


def fetch(url):
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=20) as response:
                return response.read().decode('utf-8')
        except (OSError, urllib.error.URLError):
            if attempt == 2:
                raise
            time.sleep(1)


def import_asset(url):
    slug = re.search(r'(peep-(?:sitting-|standing-)?\d+)\.svg', url).group(1)
    svg = fetch(url)
    if '<svg ' not in svg or re.search(r'<(?:script|foreignObject|image)\b|\bon\w+=|(?:href|src)=["\']https?://', svg, re.I):
        raise ValueError('Unsupported SVG content: ' + slug)
    match = re.search(r'viewBox="([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)"', svg)
    if not match:
        raise ValueError('Missing SVG viewBox: ' + slug)
    x, y, width, height = map(float, match.groups())
    # Busts already frame the upper body. Full poses need a smaller head/shoulder crop.
    edge = min(width, height) if not re.search(r'peep-(standing|sitting)-', slug) else min(width, height * 0.44)
    face = svg.replace(match.group(0), f'viewBox="{x + (width-edge)/2:g} {y:g} {edge:g} {edge:g}"', 1)
    face = re.sub(r'(<svg\b[^>]*\bwidth=")[^"]+', r'\g<1>256px', face, count=1)
    face = re.sub(r'(<svg\b[^>]*\bheight=")[^"]+', r'\g<1>256px', face, count=1)
    DEST.joinpath(slug + '.svg').write_text(svg)
    DEST.joinpath(slug + '-face.svg').write_text(face)
    pack = 'standing' if 'standing-' in slug else 'sitting' if 'sitting-' in slug else 'busts'
    base = '/assets/avatar-libraries/open-peeps/'
    return pack, {
        'id': slug, 'portraitUrl': base + slug + '.svg', 'faceUrl': base + slug + '-face.svg',
        'version': hashlib.sha256((svg + face).encode()).hexdigest()[:16], 'originalUrl': url,
    }


if __name__ == '__main__':
    DEST.mkdir(parents=True, exist_ok=True)
    page = fetch(SOURCE)
    urls = sorted(set(re.findall(r'href="([^"]+\.svg)"', page)))
    packs = {'busts': [], 'standing': [], 'sitting': []}
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        for index, (pack, asset) in enumerate(pool.map(import_asset, urls), 1):
            packs[pack].append(asset)
            if index % 20 == 0:
                print(f'Imported {index}/{len(urls)} original Open Peeps SVGs', flush=True)
    for assets in packs.values():
        assets.sort(key=lambda asset: int(asset['id'].rsplit('-', 1)[1]))
    MANIFEST.write_text(json.dumps(packs, ensure_ascii=False, indent=2) + '\n')
    DEST.joinpath('LICENSE.txt').write_text(
        'Open Peeps by Pablo Stanley\nSource: https://www.openpeeps.com/\n'
        'CC0 1.0 Universal: https://creativecommons.org/publicdomain/zero/1.0/\n'
        'Original publicly downloadable SVGs. Face variants change the viewBox and dimensions only.\n'
        'Per-image original download URLs are retained in open-peeps-assets.json.\n')
    print({name: len(assets) for name, assets in packs.items()}, flush=True)
