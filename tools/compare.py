# python tools/compare.py samples/x.png out/x.render.png scale name x y w h [zoom]
import sys
from PIL import Image
src, ren, sc, name = sys.argv[1], sys.argv[2], float(sys.argv[3]), sys.argv[4]
x, y, w, h = map(int, sys.argv[5:9]); z = int(sys.argv[9]) if len(sys.argv) > 9 else 4
a = Image.open(src).convert('RGB').crop((x, y, x + w, y + h)).resize((w * z, h * z), Image.NEAREST)
b = Image.open(ren).convert('RGB').crop((int(x * sc), int(y * sc), int((x + w) * sc), int((y + h) * sc))).resize((w * z, h * z), Image.LANCZOS)
o = Image.new('RGB', (w * z * 2 + 8, h * z), (255, 0, 0)); o.paste(a, (0, 0)); o.paste(b, (w * z + 8, 0)); o.save(f'out/cmp_{name}.png')
