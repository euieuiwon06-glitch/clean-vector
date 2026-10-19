#!/bin/sh
# 포스터 샘플 표준 비교 세트
RENDER_SCALE=4 node tools/run.mjs samples/naver-poster.png "$1" | tail -2
for a in "n 780 1280 180 180" "title 50 860 260 140 3" "icon 860 800 120 110" "net 40 140 180 180" "body 55 1150 250 70 3" "arrow 700 1180 260 140 3"; do set -- $a; python tools/compare.py samples/naver-poster.png out/naver-poster.render.png 4 $@; done
