#!/usr/bin/env python3
"""test.html 을 자체 완결(self-contained) 파일로 빌드.

wayfinding_data.js (window.AIRPORT_DATA) 와 airport25d.js 를 test.html 안에 인라인 →
다른 파일/서버 없이 더블클릭(file://)만으로 즉시 테스트 가능.

idempotent: <script src="..."> 형태든, 이미 인라인된 <!--X:START-->..<!--X:END--> 형태든
모두 최신 소스로 다시 치환한다. 소스(airport25d.js / wayfinding_data.js) 수정 후 재실행하면 갱신됨.

사용: python3 map/_build_test.py
"""
import re, pathlib

BASE = pathlib.Path(__file__).resolve().parent
data = (BASE / "wayfinding_data.js").read_text(encoding="utf-8")
lib  = (BASE / "airport25d.js").read_text(encoding="utf-8")
html = (BASE / "test.html").read_text(encoding="utf-8")

def esc(s):  # <script> 조기 종료 방지
    return re.sub(r"</script", r"<\\/script", s, flags=re.I)

data_block = "<!--DATA:START--><script>\n" + esc(data) + "\n</script><!--DATA:END-->"
lib_block  = "<!--LIB:START--><script>\n"  + esc(lib)  + "\n</script><!--LIB:END-->"

def sub_all(pattern, repl, text, flags=0):
    return re.sub(pattern, lambda m: repl, text, flags=flags)

# 데이터
html = sub_all(r'<script src="wayfinding_data\.js"></script>', data_block, html)
html = sub_all(r'<!--DATA:START-->.*?<!--DATA:END-->', data_block, html, re.S)
# 라이브러리
html = sub_all(r'<script src="airport25d\.js"></script>', lib_block, html)
html = sub_all(r'<!--LIB:START-->.*?<!--LIB:END-->', lib_block, html, re.S)

(BASE / "test.html").write_text(html, encoding="utf-8")
print(f"built self-contained test.html: {len(html):,} bytes "
      f"(data {len(data):,} + lib {len(lib):,} inlined)")
