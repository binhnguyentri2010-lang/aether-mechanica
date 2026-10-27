#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Đóng gói ứng dụng thành MỘT trang để đăng làm Artifact (chia sẻ bằng link claude.ai).

Khác dist/aether-mechanica.html ở ba điểm, đều do luật của Artifact:

1. KHÔNG dùng blob: URL. CSP của Artifact chỉ cho script inline và vài CDN; import() một blob:
   có thể bị chặn âm thầm. Ở đây mọi module (kể cả three.js) được GỘP vào một <script type=module>
   duy nhất: mỗi module chạy trong một hàm riêng (giữ phạm vi riêng như ES module thật), import /
   export được đổi thành đọc/ghi một bảng __M theo đúng thứ tự phụ thuộc.
2. KHÔNG có <!doctype>/<html>/<head>/<body>: nền tảng tự bọc trang (charset, viewport). File chỉ
   gồm <title>, <style>, phần thân và script.
3. <title> nằm đầu file (nền tảng chỉ quét 8KB đầu).

Chỉ hỗ trợ đúng những dạng import/export dự án đang dùng; gặp dạng khác thì DỪNG, không đoán.
Chỉ dùng thư viện chuẩn Python.

Chạy:  python tools\\build_artifact.py   → dist/aether-mechanica.artifact.html
"""

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build as B  # dùng lại collect() / inline_css() của build.py  # noqa: E402

ROOT = B.ROOT
OUT = ROOT / "dist" / "aether-mechanica.artifact.html"
PH = r"""['"]__AM_MOD_(.+?)__['"]"""

IMPORT_NAMED = re.compile(r"(?m)^[ \t]*import\s*\{([^}]*)\}\s*from\s*" + PH + r"[ \t]*;?")
IMPORT_NS = re.compile(r"(?m)^[ \t]*import\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s*from\s*" + PH + r"[ \t]*;?")
EXPORT_FROM = re.compile(r"(?m)^[ \t]*export\s*\{([^}]*)\}\s*from\s*" + PH + r"[ \t]*;?")
EXPORT_LIST = re.compile(r"(?m)^[ \t]*export\s*\{([^}]*)\}[ \t]*;?")
EXPORT_DECL = re.compile(r"(?m)^([ \t]*)export\s+(const|let|var|class|function\*?|async\s+function)\s+([A-Za-z_$][\w$]*)")
LEFTOVER = re.compile(r"(?m)^[ \t]*(import|export)\b")


def pairs(spec):
    """'A, B as C' → [('A','A'), ('B','C')]  (tên gốc, tên dùng)."""
    out = []
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        m = re.fullmatch(r"([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?", part)
        if not m:
            B.die("Khong hieu danh sach import/export: %r" % part)
        out.append((m.group(1), m.group(2) or m.group(1)))
    return out


def transform(mid, code):
    exports = []  # (tên export, biểu thức)

    def imp_named(m):
        spec = ", ".join(a if a == b else "%s: %s" % (a, b) for a, b in pairs(m.group(1)))
        return "const { %s } = __M[%r];" % (spec, m.group(2))

    code = IMPORT_NAMED.sub(imp_named, code)
    code = IMPORT_NS.sub(lambda m: "const %s = __M[%r];" % (m.group(1), m.group(2)), code)

    def exp_from(m):
        for orig, name in pairs(m.group(1)):
            exports.append((name, "__M[%r].%s" % (m.group(2), orig)))
        return ""

    code = EXPORT_FROM.sub(exp_from, code)

    def exp_list(m):
        for local, name in pairs(m.group(1)):
            exports.append((name, local))
        return ""

    code = EXPORT_LIST.sub(exp_list, code)

    def exp_decl(m):
        exports.append((m.group(3), m.group(3)))
        return "%s%s %s" % (m.group(1), m.group(2), m.group(3))

    code = EXPORT_DECL.sub(exp_decl, code)

    left = LEFTOVER.search(code)
    if left:
        line = code[left.start():code.find("\n", left.start())]
        B.die("%s con cau lenh import/export chua ho tro: %s" % (mid, line.strip()[:120]))

    body = ", ".join(n if n == e else "%s: %s" % (n, e) for n, e in exports)
    return "__M[%r] = (() => {\n%s\nreturn { %s };\n})();\n" % (mid, code, body)


def main():
    order, mods = B.collect("src/main.js")
    parts = ["const __M = {};\n"]
    for mid in order:
        parts.append("// ── %s ──\n" % mid)
        parts.append(transform(mid, mods[mid]))
    js = "".join(parts)
    # "</script" trong mã sẽ cắt ngang thẻ; "<\/" là escape hợp lệ trong chuỗi/regex/comment JS
    js = re.sub(r"</(script)", r"<\\/\1", js, flags=re.I)
    if "<!--" in js:
        B.die("Ma nguon co '<!--' — de gay loi phan tich the <script>, can xu ly rieng.")

    html_path = ROOT / "index.html"
    html = B.inline_css(html_path.read_text(encoding="utf-8"), html_path)
    title = re.search(r"<title>.*?</title>", html, re.S).group(0)
    styles = "\n".join(re.findall(r"<style>.*?</style>", html, re.S))
    body = re.search(r"<body>(.*?)<!--APP:START-->", html, re.S).group(1).strip()

    page = "%s\n%s\n%s\n<script type=\"module\">\n%s</script>\n" % (title, styles, body, js)
    if re.search(r"""\b(?:src|href)\s*=\s*["']\s*(https?:)?//""", page.replace(js, "")):
        B.die("Con tham chieu ra mang trong phan HTML.")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(page, encoding="utf-8")
    print("Da gop %d module -> %s" % (len(order), OUT))
    print("Kich thuoc: {:,} bytes".format(OUT.stat().st_size))


if __name__ == "__main__":
    main()
