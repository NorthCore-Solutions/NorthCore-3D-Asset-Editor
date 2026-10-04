"""Native integer face authoring, using the pose recipe's underlying muzzle/fur.
No PNG resampling, Legacy renderer, alpha blending or runtime authoring.
"""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
recipe = {'__file__': str(ROOT / 'scripts/author-native-poses.py')}
exec(compile((ROOT / 'scripts/author-native-poses.py').read_text(encoding='utf8').split("manifest = ")[0],
             str(ROOT / 'scripts/author-native-poses.py'), 'exec'), recipe)
DATA = ROOT / 'src/animation/data/faces'
DATA.mkdir(exist_ok=True)
neutral = recipe['neutral']
manifest = {'catalogVersion': 1, 'presetVersion': 1, 'assets': {}, 'bases': {}}

def write(name, pixels, width=128, height=128):
    asset = {'assetVersion': 1, 'width': 128, 'height': 128, 'contentWidth': width,
             'contentHeight': height, 'pixels': sorted(pixels.items())}
    (DATA / (name + '.json')).write_text(json.dumps(asset, separators=(',', ':')) + '\n')
    return {'asset': name + '.json', 'pixelSha256': hashlib.sha256(
        b''.join(pixels.get(k, 0).to_bytes(4, 'big') for k in range(16384))).hexdigest()}

# Remove authored facial features from the area stack before rasterization, so
# the original muzzle/fur beneath them is retained (including its outline).
for pose_id, _, areas, details, _ in recipe['poses']:
    dx, dy = {'sitting_relaxed': (2, 20), 'reading': (0, 15), 'sleeping': (22, 70)}.get(pose_id, (0, 0))
    remove = [recipe['area'](a['color'], [(x + dx, y + dy) for x, y in a['points']])
              for a in neutral['areas'][46:50] + neutral['areas'][52:]]
    if pose_id == 'sleeping':
        remove += recipe['head'](dx, dy, sleeping=True)[-2:]
    filtered = [a for a in areas if a not in remove]
    filtered_details = [p for p in details if tuple(p) not in recipe['glints'](dx, dy)]
    manifest['bases'][pose_id] = write(pose_id + '-face-free', recipe['raster'](filtered, filtered_details))

ink = 0x382218FF
black = 0x100E0DFF
highlight = 0xF8F8ECFF
pink = 0xBD7766FF
eye_patterns = {
    'open': ['.##.', '#w##', '####', '.##.'],
    'half': ['....', '####', '#w##', '.##.'],
    'closed': ['....', '....', '####', '....'],
    'happy': ['.##.', '#..#', '....', '....'],
    'surprised': ['.##.', '#ww#', '#ww#', '.##.'],
}
mouth_patterns = {
    'neutral': ['........', '.######.', '........', '........'],
    'smile': ['#......#', '.#....#.', '..####..', '........'],
    'open': ['..####..', '.######.', '.##pp##.', '..####..'],
    'chew': ['........', '.####...', '....###.', '........'],
    'sad': ['..####..', '.#....#.', '#......#', '........'],
}
for family, patterns in [('eye', eye_patterns), ('mouth', mouth_patterns), ('mouth-v1', mouth_patterns)]:
    for state, rows in patterns.items():
        # V1 compatibility uses a separately authored wider/lower mouth, rather
        # than silently reusing the V2 replacement/preset.
        if family == 'mouth-v1':
            rows = ['..........'] + ['.' + row + '.' for row in rows] + ['..######..']
        pixels = {y * 128 + x: {'#': black if family == 'eye' else ink, 'w': highlight, 'p': pink}[c]
                  for y, row in enumerate(rows) for x, c in enumerate(row) if c != '.'}
        manifest['assets'][family + '-' + state] = write(family + '-' + state, pixels, len(rows[0]), len(rows))
(DATA / 'catalog.json').write_text(json.dumps(manifest, indent=2) + '\n')

# Optional visual authoring reference. Production never loads this sheet.
try:
    from PIL import Image, ImageDraw
except ImportError:
    print('Face assets generated; Pillow is optional for the documentation sheet.')
else:
    sheet = Image.new('RGB', (6 * 256, 550), '#ede6dc')
    draw = ImageDraw.Draw(sheet)
    for i, pose_id in enumerate(manifest['bases']):
        base = dict(json.loads((DATA / (pose_id + '-face-free.json')).read_text())['pixels'])
        dx, dy = {'sitting_relaxed': (2, 20), 'reading': (0, 15), 'sleeping': (22, 70)}.get(pose_id, (0, 0))
        pixels = dict(base)
        for name, x, y in [('eye-closed' if pose_id == 'sleeping' else 'eye-open', 69 + dx, 12 + dy),
                           ('eye-closed' if pose_id == 'sleeping' else 'eye-open', 80 + dx, 11 + dy),
                           ('mouth-neutral', 74 + dx, 20 + dy)]:
            for k, value in json.loads((DATA / (name + '.json')).read_text())['pixels']:
                pixels[(y + k // 128) * 128 + x + k % 128] = value
        for row, values in enumerate([base, pixels]):
            image = Image.new('RGBA', (128, 128))
            for k, value in values.items():
                image.putpixel((k % 128, k // 128), tuple(value.to_bytes(4, 'big')))
            enlarged = image.resize((256, 256), Image.Resampling.NEAREST)
            sheet.paste(enlarged, (i * 256, 24 + row * 270), enlarged)
        draw.text((i * 256 + 8, 6), pose_id, fill='#20130f')
    sheet.save(ROOT / 'docs/native-face-catalog.png')
