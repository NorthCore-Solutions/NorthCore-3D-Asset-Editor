"""Offline native pixel authoring. No tracing/Legacy image loading or downsampling.

Integer polygons, neutral palette/head geometry, literal pixel details. Production
loads the resulting 128x128 pixel maps, never this authoring recipe.
Run from repository root: python scripts/author-native-poses.py
"""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NEUTRAL = ROOT / 'src/animation/data/standing-neutral.json'
DATA = ROOT / 'src/animation/data/poses'
DATA.mkdir(parents=True, exist_ok=True)
neutral = json.loads(NEUTRAL.read_text(encoding='utf8'))
OUTLINE = neutral['outline']
PALETTE = {'fur': 0x82573FFF, 'shade': 0x6F4732FF, 'light': 0x92664AFF,
           'dark': 0x503022FF, 'crease': 0x382218FF, 'belly': 0xBD9A78FF,
           'bellyShade': 0xA68163FF, 'cream': 0xD1B391FF}


def area(color, points):
    return {'color': PALETTE.get(color, color), 'points': points}


def head(dx=0, dy=0, sleeping=False):
    pieces = []
    for index, item in enumerate(neutral['areas'][37:], 37):
        if sleeping and index >= 52:
            continue
        pieces.append(area(item['color'], [(x + dx, y + dy) for x, y in item['points']]))
    if sleeping:
        pieces += [area('crease', [(69 + dx, 14 + dy), (71 + dx, 15 + dy), (74 + dx, 14 + dy),
                                  (74 + dx, 15 + dy), (71 + dx, 17 + dy), (69 + dx, 16 + dy)]),
                   area('crease', [(80 + dx, 13 + dy), (83 + dx, 12 + dy), (83 + dx, 14 + dy), (80 + dx, 15 + dy)])]
    return pieces


def glints(dx=0, dy=0):
    return [(x + dx, y + dy, value) for x, y, value in neutral['glints']]


def sitting_body():
    return [
        area('shade', [(57, 86), (60, 100), (49, 106), (34, 110), (20, 111), (18, 109), (34, 104), (46, 97)]),
        area('light', [(50, 99), (53, 102), (42, 106), (24, 109), (40, 104)]),
        area('dark', [(42, 103), (61, 99), (70, 107), (83, 107), (99, 110), (96, 114), (71, 114), (49, 111), (41, 108)]),
        area('fur', [(63, 40), (77, 40), (82, 47), (86, 65), (88, 77), (97, 88), (98, 96), (92, 103), (75, 108), (52, 108), (43, 99), (43, 88), (50, 74), (55, 56)]),
        area('shade', [(55, 56), (59, 54), (57, 74), (52, 85), (51, 100), (63, 105), (54, 108), (45, 101), (43, 92), (47, 80)]),
        area('light', [(48, 90), (52, 86), (54, 99), (64, 104), (53, 103), (48, 100)]),
        area('bellyShade', [(66, 42), (76, 43), (80, 50), (82, 70), (87, 85), (84, 96), (76, 101), (65, 98), (60, 87), (61, 67)]),
        area('belly', [(68, 43), (75, 44), (79, 55), (79, 73), (84, 85), (81, 94), (74, 98), (66, 94), (64, 82), (65,60)]),
        area('cream', [(66, 40), (77, 42), (80, 50), (77, 60), (72, 63), (67, 56)]),
        area('shade', [(52, 91), (62, 94), (68, 103), (63, 112), (55, 115), (45, 112), (43, 107), (46, 99)]),
        area('light', [(50, 97), (58, 96), (63, 103), (60, 111), (54, 112), (48, 108)]),
        area('crease', [(55, 109), (56, 111), (55, 114), (54, 113)]),
        area('crease', [(59, 110), (60, 112), (59, 114), (58, 113)]),
        area('shade', [(81, 94), (89, 91), (94, 95), (98, 104), (95, 112), (88, 114), (79, 110), (76, 104)]),
        area('light', [(86, 97), (90, 95), (94, 101), (94, 108), (88, 111), (82, 107)]),
        area('crease', [(88, 108), (89, 110), (88, 113), (87, 112)]),
        area('crease', [(92, 107), (94, 109), (93, 112), (92, 111)]),
    ]


active = neutral['areas'][:19] + neutral['areas'][31:37] + [
    area('crease', [(56, 35), (60, 30), (65, 29), (69, 33), (68, 38), (64, 41), (61, 52), (56, 55), (52, 50), (52, 44)]),
    area('fur', [(57, 35), (61, 31), (65, 31), (67, 34), (66, 37), (62, 40), (59, 50), (56, 52), (54, 49), (55, 43)]),
    area('light', [(58, 36), (61, 33), (65, 33), (64, 36), (60, 40), (58, 46), (56, 47)]),
    area('shade', [(61, 41), (63, 39), (62, 48), (58, 52), (55, 51)]),
    area('crease', [(82, 38), (87, 40), (88, 47), (92, 43), (92, 35), (95, 32), (99, 36), (99, 42), (96, 47), (92, 55), (87, 58), (83, 53)]),
    area('fur', [(84, 40), (86, 42), (87, 50), (90, 51), (94, 43), (94, 36), (96, 34), (98, 38), (97, 42), (94, 48), (91, 54), (87, 56), (85, 52)]),
    area('light', [(94, 36), (96, 35), (97, 38), (96, 41), (94, 42)]),
    area('shade', [(86, 49), (88, 52), (91, 51), (93, 48), (90, 55), (87, 54)]),
] + head()

sitting = sitting_body() + [
    area('crease', [(55, 59), (59, 62), (62, 77), (67, 85), (67, 91), (63, 95), (59, 91), (54, 80), (51, 69)]),
    area('fur', [(55, 61), (58, 64), (60, 78), (65, 86), (65, 91), (62, 93), (58, 87), (55, 78), (53, 69)]),
    area('light', [(54, 64), (56, 65), (57, 77), (62, 86), (60, 87), (55, 79)]),
    area('crease', [(81, 56), (84, 62), (86, 77), (84, 86), (79, 93), (75, 91), (74, 86), (78, 77), (79, 62)]),
    area('fur', [(81, 60), (83, 65), (84, 77), (81, 85), (78, 90), (76, 89), (77, 85), (80, 77)]),
] + head(2, 20)

reading = sitting_body() + head(0, 15) + [
    area('shade', [(84, 59), (88, 61), (91, 68), (99,70), (99, 76), (93, 80), (87, 75), (84, 68)]),
    area('fur', [(86, 61), (88, 64), (89, 70), (95, 72), (97, 71), (97, 75), (93, 77), (88, 73)]),
    area(0x283C51FF, [(69, 69), (80, 72), (88, 70), (105, 60), (111, 62), (108, 94), (88, 108), (68, 99)]),
    area(0x3D5C7EFF, [(72, 72), (81, 76), (85, 77), (85, 103), (71, 96)]),
    area(0x628CA3FF, [(88, 76), (105, 65), (107, 65), (104, 91), (89, 102)]),
    area(0xD5D6B6FF, [(73, 70), (82, 73), (87, 73), (105, 62), (107, 63), (88, 77), (81, 76), (73, 73)]),
    area(0xA7B2A0FF, [(71, 97), (84, 104), (88, 105), (105, 93), (105, 95), (88, 108), (84, 107), (71, 100)]),
    area('crease', [(56, 60), (60, 64), (61, 77), (72,80), (76, 79), (79, 83), (77, 87), (73, 89), (62, 87), (55, 80), (53, 69)]),
    area('fur', [(56, 63), (59, 67), (59, 79), (70, 83), (75, 81), (77, 84), (75, 86), (70, 87), (60, 84), (56, 78), (54, 70)]),
    area('light', [(55, 66), (57, 68), (57, 78), (62, 81), (64, 84), (58, 82), (55, 77)]),
]

sleeping = [
    area('shade', [(41, 100), (29, 102), (22, 108), (26, 114), (37, 117), (70, 117), (80, 114), (72, 110), (46, 109)]),
    area('light', [(29, 105), (25, 108), (30, 112), (41, 114), (70, 114), (68, 112), (42, 111)]),
    area('fur', [(33, 97), (32, 91), (36, 83), (46, 76), (61, 74), (74, 78), (84, 85), (91, 94), (91, 105), (83, 112), (65, 115), (47, 112), (37, 107)]),
    area('shade', [(34, 95), (37, 89), (42, 89), (43, 99), (54, 107), (74, 109), (84, 106), (88, 100), (88, 107), (79, 112), (62, 113), (46, 109), (36, 103)]),
    area('light', [(39, 87), (48, 79), (60, 77), (70, 79), (76, 84), (74, 87), (63, 81), (51, 83), (44, 90)]),
    area('dark', [(46, 96), (50, 99), (56, 101), (62, 99), (61, 101), (56, 104), (49, 102), (45, 99)]),
    area('bellyShade', [(79, 87), (88, 88), (97, 98), (103, 104), (103, 110), (97, 114), (84, 111), (75, 104)]),
    area('belly', [(83, 90), (90, 95), (97, 103), (100, 105), (100, 110), (94, 112), (84, 108), (78, 102)]),
    area('shade', [(83, 100), (88, 101), (91, 106), (98, 108), (106, 107), (110, 109), (108, 113), (97, 115), (89, 113), (84, 109)]),
    area('fur', [(87, 103), (91, 108), (99, 111), (106, 109), (108, 110), (105, 112), (97, 113), (90, 111), (86, 107)]),
    area('crease', [(103, 111), (104, 110), (105, 112), (104, 113)]),
] + head(22,70, sleeping=True)

eating = neutral['areas'][:19] + neutral['areas'][31:37] + head() + [
    area('dark', [(62, 30), (76, 28), (81, 34), (82, 57), (77, 68), (68, 67), (62, 59), (59, 39)]),
    area(0xC84A38FF, [(63, 31), (76, 30), (79, 35), (80, 56), (76, 65), (69, 64), (64, 57), (61, 39)]),
    area('cream', [(64, 30), (70, 32), (76, 29), (77, 32), (72, 36), (68, 36)]),
    area('crease', [(54, 33), (58, 35), (58, 46), (64, 49), (64, 55), (60, 58), (54, 54), (50, 47), (50, 39)]),
    area('fur', [(54, 35), (56, 37), (56, 47), (62, 51), (62, 54), (60, 56), (55, 52), (52, 46), (52, 40)]),
    area('light', [(52, 41), (54, 38), (55,40), (54, 46), (58, 51), (56, 51), (52, 46)]),
    area('crease', [(83, 40), (88, 41), (89, 48), (93,40), (93, 32), (96, 31), (98, 35), (98,40), (95, 49), (91, 55), (86, 56), (83, 51)]),
    area('fur', [(85, 42), (87, 43), (87, 51), (90, 52), (94, 45), (95, 35), (96, 33), (97, 36), (96, 41), (93, 49), (90, 54), (86, 54), (85, 50)]),
    area(0xA7B2BAFF, [(53, 23), (56, 22), (58, 24), (58, 28), (56, 31), (56, 39), (54, 39), (54, 31), (52, 28), (52, 25)]),
    area(0xE0E4DDFF, [(54, 24), (56, 24), (57, 26), (56, 28), (54, 28), (53, 26)]),
    area(0xA7B2BAFF, [(94, 24), (96, 24), (96, 36), (94, 36)]),
    area(0xA7B2BAFF, [(91, 19), (92, 19), (92, 24), (98, 24), (98, 19), (99, 19), (99, 26), (97, 28), (94, 28), (91, 26)]),
    area(0xE0E4DDFF, [(94, 19), (95, 19), (95, 25), (94, 25)]),
]


def polygon_pixels(points):
    output = set()
    for y in range(128):
        for x in range(128):
            inside = False
            for i, b in enumerate(points):
                a = points[i - 1]
                if a[1] > b[1]:
                    a, b = b, a
                cy = 2 * y + 1
                if 2 * a[1] <= cy < 2 * b[1] and (2 * x + 1 - 2 * a[0]) * (b[1] - a[1]) < (cy - 2 * a[1]) * (b[0] - a[0]):
                    inside = not inside
            if inside:
                output.add(y * 128 + x)
    return output


def raster(areas, details):
    colors = {}
    for item in areas:
        for k in polygon_pixels(item['points']):
            colors[k] = item['color']
    for x, y, value in details:
        colors[y * 128 + x] = value
    output = {}
    for k in colors:
        x, y = k % 128, k // 128
        for dx, dy in [(0, -1), (-1, 0), (1, 0), (0, 1)]:
            if 0 <= x + dx < 128 and 0 <= y + dy < 128:
                output[(y + dy) * 128 + x + dx] = OUTLINE
    output.update(colors)
    return output


# Native bib checks are literal opaque squares, clipped to the manually drawn bib.
bib_pixels = polygon_pixels([(63, 31), (76, 30), (79, 35), (80, 56), (76, 65), (69, 64), (64, 57), (61, 39)])
bib_details = [(k % 128, k // 128, 0xE4D6B8FF) for k in bib_pixels if ((k % 128) // 3 + (k // 128) // 3) % 2 == 0]
poses = [
    ('standing_neutral', 'Stehend – neutral', neutral['areas'], neutral['glints'], 'unchanged-neutral-v1'),
    ('standing_active', 'Stehend – aktiv', active, glints(), 'native-redraw-raised-paws'),
    ('sitting_relaxed', 'Sitzend – entspannt', sitting, glints(2, 20), 'native-redraw-seated'),
    ('sleeping', 'Schlafend', sleeping, [], 'native-redraw-curled-closed-eyes'),
    ('reading', 'Lesend', reading, glints(0, 15), 'native-redraw-seated-book'),
    ('eating', 'Essend', eating, glints() + bib_details, 'native-redraw-bib-cutlery'),
]
def canonical_hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode('utf8')).hexdigest()


manifest = {'catalogVersion': 1, 'anchorSha256': canonical_hash(neutral), 'poses': []}
for pose_id, label, areas, details, method in poses:
    pixels = raster(areas, details)
    asset = {'assetVersion': 1, 'width': 128, 'height': 128, 'pixels': sorted(pixels.items())}
    encoded = (json.dumps(asset, separators=(',', ':')) + '\n').encode('utf8')
    (DATA / f'{pose_id}.json').write_bytes(encoded)
    rgba_bytes = b''.join(pixels.get(k, 0).to_bytes(4, 'big') for k in range(16384))
    manifest['poses'].append({'id': pose_id, 'sourceId': f'fino-{pose_id.replace("_", "-")}-128', 'name': label, 'asset': f'{pose_id}.json',
                              'assetVersion': 1, 'assetSha256': canonical_hash(asset), 'pixelSha256': hashlib.sha256(rgba_bytes).hexdigest(),
                              'authoring': method, 'reference': f'public/animation/tracing/fino_{pose_id}_128.png'})
(DATA / 'catalog.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf8')

# Optional documentation contact sheet; all enlargement uses nearest neighbor.
try:
    from PIL import Image, ImageDraw
except ImportError:
    print('Native assets generated; Pillow is optional for the documentation sheet.')
    raise SystemExit(0)
sheet = Image.new('RGB', (6 * 256, 280), '#ede6dc')
draw = ImageDraw.Draw(sheet)
for i, (pose_id, _, _, _, _) in enumerate(poses):
    asset = json.loads((DATA / f'{pose_id}.json').read_text())
    image = Image.new('RGBA', (128, 128))
    for k, value in asset['pixels']:
        image.putpixel((k % 128, k // 128), tuple(value.to_bytes(4, 'big')))
    sheet.paste(image.resize((256, 256), Image.Resampling.NEAREST), (i * 256, 24), image.resize((256, 256), Image.Resampling.NEAREST))
    draw.text((i * 256 + 8, 6), pose_id, fill='#20130f')
sheet.save(ROOT / 'docs/native-pose-catalog.png')
