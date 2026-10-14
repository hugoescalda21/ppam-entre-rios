# Arma las animaciones de la bienvenida (img/bienvenida/pasoN.webp y pasoN-fijo.webp) con los cuadros de capturar.js.
# Requiere Pillow:  pip install pillow
import json, os
from PIL import Image, ImageDraw
AQUI = os.path.dirname(os.path.abspath(__file__))
DEST = os.path.join(AQUI, '..', '..', 'img', 'bienvenida')
P = json.load(open(os.path.join(AQUI, 'cuadros', 'pasos.json')))
RECORTE = {'1': [230, 230, 0], '2': 0, '3': 284, '4': 0}   # desde qué altura (px CSS) se toma cada cuadro
H = 560
for k, cuadros in P.items():
    out, durs = [], []
    for n, fr in enumerate(cuadros):
        y0 = RECORTE[k][n] if isinstance(RECORTE[k], list) else RECORTE[k]
        im = Image.open(fr['f']).convert('RGB').crop((0, y0 * 2, 780, (y0 + H) * 2)).resize((390, H), Image.LANCZOS)
        if fr['tap']:   # círculo verde donde toca el hermano
            x, y = fr['tap']['x'], fr['tap']['y'] - y0
            for r, a in [(26, 70), (17, 140)]:
                ov = Image.new('RGBA', im.size, (0, 0, 0, 0)); d = ImageDraw.Draw(ov)
                d.ellipse((x - r, y - r, x + r, y + r), fill=(18, 67, 63, a), outline=(255, 255, 255, 220), width=3 if r == 26 else 0)
                im = Image.alpha_composite(im.convert('RGBA'), ov).convert('RGB')
        out.append(im); durs.append(fr['ms'])
    out[0].save(os.path.join(DEST, f'paso{k}.webp'), save_all=True, append_images=out[1:], duration=durs, loop=0, quality=72, method=6)
    out[0 if k != '4' else -1].save(os.path.join(DEST, f'paso{k}-fijo.webp'), quality=75, method=6)
    print('paso', k, os.path.getsize(os.path.join(DEST, f'paso{k}.webp')) // 1024, 'KB')
