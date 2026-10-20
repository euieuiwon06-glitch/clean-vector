# AI 확대 시험: python tools/upscale.py model.onnx in.png out.png [최종배율]
import sys, time
import numpy as np
import onnxruntime as ort
from PIL import Image
model, src, dst = sys.argv[1:4]
final = float(sys.argv[4]) if len(sys.argv) > 4 else 2
s = ort.InferenceSession(model, providers=['CPUExecutionProvider'])
im = np.asarray(Image.open(src).convert('RGB')).astype(np.float32) / 255
H, W, _ = im.shape
T, P = 256, 16
out = np.zeros((H * 4, W * 4, 3), np.float32)
t0 = time.time()
for y in range(0, H, T):
    for x in range(0, W, T):
        y0, x0 = max(0, y - P), max(0, x - P)
        y1, x1 = min(H, y + T + P), min(W, x + T + P)
        tile = im[y0:y1, x0:x1].transpose(2, 0, 1)[None]
        r = s.run(None, {'input': tile})[0][0].transpose(1, 2, 0)
        oy, ox = (y - y0) * 4, (x - x0) * 4
        hh, ww = min(T, H - y) * 4, min(T, W - x) * 4
        out[y * 4:y * 4 + hh, x * 4:x * 4 + ww] = r[oy:oy + hh, ox:ox + ww]
print('sec', round(time.time() - t0, 1))
img = Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8))
if final != 4: img = img.resize((int(W * final), int(H * final)), Image.LANCZOS)
img.save(dst)
