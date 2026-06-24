#!/usr/bin/env python3
"""모듈형 소스(*.src.html)를 자체 완결(self-contained) *.html 로 빌드.

wayfinding_data.js (window.AIRPORT_DATA) 와 airport25d.js 를 인라인 →
다른 파일/서버 없이 더블클릭(file://)만으로 즉시 실행.

소스(편집용, <script src> 사용):
  test.src.html   → test.html    (3D 길찾기 뷰; 데이터+라이브러리 인라인)
  align.src.html  → align.html   (2D 탑다운 정합 도구; 데이터 인라인)

사용: python3 map/_build_test.py
소스(airport25d.js / wayfinding_data.js / *.src.html) 수정 후 재실행하면 갱신됨.
"""
import re, pathlib

BASE = pathlib.Path(__file__).resolve().parent
data = (BASE / "wayfinding_data.js").read_text(encoding="utf-8")
lib  = (BASE / "airport25d.js").read_text(encoding="utf-8")

def esc(s):  # <script> 조기 종료 방지
    return re.sub(r"</script", r"<\\/script", s, flags=re.I)

DATA_BLK = "<script>\n" + esc(data) + "\n</script>"
LIB_BLK  = "<script>\n" + esc(lib)  + "\n</script>"

def build(src_name, out_name):
    html = (BASE / src_name).read_text(encoding="utf-8")
    html = re.sub(r'<script src="wayfinding_data\.js"></script>', lambda m: DATA_BLK, html)
    html = re.sub(r'<script src="airport25d\.js"></script>',      lambda m: LIB_BLK,  html)
    (BASE / out_name).write_text(html, encoding="utf-8")
    return len(html)

for src, out in [("test.src.html", "test.html"), ("align.src.html", "align.html"), ("gap.src.html", "gap.html")]:
    n = build(src, out)
    print(f"built {out}: {n:,} bytes")
print(f"(inlined data {len(data):,} + lib {len(lib):,})")
