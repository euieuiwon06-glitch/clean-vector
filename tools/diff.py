# python tools/diff.py src.png render.png scale name x y w h zoom
# 빠진 잉크=빨강, 남는 잉크=파랑, 일치=검정. 전체 재현율/정밀도도 출력
import sys
import numpy as np
from PIL import Image
src, ren, sc, name = sys.argv[1], sys.argv[2], float(sys.argv[3]), sys.argv[4]
x, y, w, h, z = map(int, sys.argv[5:10])
a = np.asarray(Image.open(src).convert('L')).astype(float)
b = Image.open(ren).convert('L')
b = np.asarray(b.resize((int(b.width / sc), int(b.height / sc)), Image.BOX)).astype(float)
ia, ib = a < 140, b < 140
def grow(m):
    o = m.copy(); o[1:] |= m[:-1]; o[:-1] |= m[1:]; o[:, 1:] |= m[:, :-1]; o[:, :-1] |= m[:, 1:]; return o
miss = ia & ~grow(ib); extra = ib & ~grow(ia)
print(f'recall {1 - miss.sum() / max(1, ia.sum()):.3f}  precision {1 - extra.sum() / max(1, ib.sum()):.3f}')
img = np.full(a.shape + (3,), 255, np.uint8)
img[ia & ~miss] = (0, 0, 0); img[miss] = (230, 30, 30); img[extra] = (40, 90, 230)
Image.fromarray(img[y:y + h, x:x + w]).resize((w * z, h * z), Image.NEAREST).save(f'out/diff_{name}.png')
