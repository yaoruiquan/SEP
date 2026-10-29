"""Import a frozen RoboHash set1/set3 pack. Normal builds never fetch images.

Run manually to refresh the pack; existing files are reused unless --refresh is set.
Image authors, source URLs and CC BY 3.0 terms are retained beside the assets.
"""
import concurrent.futures
import hashlib
import json
import struct
import sys
import time
import urllib.error
import urllib.request
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEST = ROOT / 'web/public/assets/avatar-libraries/robohash'
MANIFEST = ROOT / 'backend/src/shared/robohash-assets.json'
PACK_SIZE = 32


def fetch(url):
    for attempt in range(5):
        try:
            request = urllib.request.Request(url, headers={'User-Agent': 'SEP-avatar-pack-import/1.0'})
            with urllib.request.urlopen(request, timeout=40) as response:
                return response.read()
        except (OSError, urllib.error.URLError):
            if attempt == 4:
                raise
            time.sleep(2 ** (attempt + 1))


def import_asset(item):
    pack, number = item
    slug = f'{pack}-{number:03d}'
    url = f'https://robohash.org/sep-digital-employee-{number:03d}.png?set={pack}&size=256x256'
    path = DEST / f'{slug}.png'
    data = path.read_bytes() if path.exists() and '--refresh' not in sys.argv else fetch(url)
    if data[:16] != b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR' or struct.unpack('>II', data[16:24]) != (256, 256):
        raise ValueError(f'Expected 256px PNG: {url}')
    # Keep attribution with the actual distributed image, without changing pixels.
    credits = {
        'Attribution': 'Robots lovingly delivered by Robohash.org. Artwork by '
                       + ('Zikri Kader.' if pack == 'set1' else 'Julian Peter Arias.'),
        'License': 'CC BY 3.0 https://creativecommons.org/licenses/by/3.0/',
        'Source': url,
    }
    chunks = [data[:8]]
    offset = 8
    while offset < len(data):
        size = struct.unpack('>I', data[offset:offset + 4])[0]
        kind = data[offset + 4:offset + 8]
        content = data[offset + 8:offset + 8 + size]
        if kind == b'IEND':
            for key, value in credits.items():
                text = (key + '\0' + value).encode('latin1')
                chunks.append(struct.pack('>I', len(text)) + b'tEXt' + text
                              + struct.pack('>I', zlib.crc32(b'tEXt' + text)))
        if not (kind == b'tEXt' and content.split(b'\0', 1)[0].decode('latin1') in credits):
            chunks.append(data[offset:offset + size + 12])
        offset += size + 12
    data = b''.join(chunks)
    path.write_bytes(data)
    local_url = f'/assets/avatar-libraries/robohash/{slug}.png'
    return pack, {
        'id': slug, 'portraitUrl': local_url, 'faceUrl': local_url,
        'version': hashlib.sha256(data).hexdigest()[:16], 'originalUrl': url,
    }


if __name__ == '__main__':
    DEST.mkdir(parents=True, exist_ok=True)
    packs = {'set1': [], 'set3': []}
    jobs = [(pack, number) for pack in packs for number in range(1, PACK_SIZE + 1)]
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        for index, (pack, asset) in enumerate(pool.map(import_asset, jobs), 1):
            packs[pack].append(asset)
            if index % 8 == 0:
                print(f'Imported {index}/{len(jobs)} RoboHash images', flush=True)
    hashes = [asset['version'] for assets in packs.values() for asset in assets]
    if len(set(hashes)) != len(hashes):
        raise ValueError('Duplicate robot images; review the pack before publishing its manifest')
    MANIFEST.write_text(json.dumps(packs, indent=2) + '\n')
    DEST.joinpath('LICENSE.txt').write_text(
        'Robots lovingly delivered by Robohash.org.\n'
        'set1 classic robots: Zikri Kader. set3 robot heads: Julian Peter Arias.\n'
        'Artwork: Creative Commons Attribution 3.0 Unported (CC BY 3.0).\n'
        'https://creativecommons.org/licenses/by/3.0/\n'
        'Source: https://robohash.org/\n'
        'Artwork license reference: https://github.com/e1ven/Robohash#robosets\n'
        'Downloaded as 256x256 PNGs. Attribution/license/source text metadata added; pixels unchanged.\n'
        'Original download URLs and content versions are retained in robohash-assets.json.\n'
        'The MIT license of the Python server is separate from the artwork license.\n')
    print({pack: len(assets) for pack, assets in packs.items()}, flush=True)
