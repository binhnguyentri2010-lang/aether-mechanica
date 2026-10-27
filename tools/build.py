#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Gộp toàn bộ ứng dụng thành MỘT file HTML mở được bằng double-click, chạy offline.

VÌ SAO CẦN: trình duyệt chặn ES module nạp qua file:// (chính sách CORS). Bản dev chạy qua
tools/serve.py thì không sao, nhưng file gửi đi phải tự đứng được, không máy chủ, không mạng.

CÁCH LÀM (giữ nguyên từ hinh-hoc-3d/tools/build.py, đã chạy thật):
- nhúng mã nguồn từng module vào HTML; lúc chạy, một script thường dựng blob URL cho từng
  module theo đúng thứ tự phụ thuộc rồi import() module gốc. Mỗi module giữ phạm vi riêng.
- thêm: mọi <link rel="stylesheet" href="(đường dẫn nội bộ)"> được thay bằng <style>.
- thêm: build THẤT BẠI nếu còn sót bất kỳ tham chiếu http(s) nào → bảo đảm 0 request ra ngoài.

Ràng buộc với mã nguồn: chỉ dùng import tĩnh. Không import() động.

Chạy:  python tools\\build.py
       python tools\\build.py --html tests/proof/index.html --entry tests/proof/main.js --out dist/proof.html
"""

import argparse
import json
import re
import sys
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parent.parent

# Bare specifier → file thật trong vendor/
BARE = {"three": "vendor/three.module.js"}

# "import ... from 'x'" và "export ... from 'x'" (chịu được khối import xuống dòng)
FROM_RE = re.compile(r"""(?:^|[\n;])[ \t]*(?:import|export)\b[^'"();]*?\bfrom[ \t]*(['"])(.+?)\1""")
# "import 'x'" — nhập chỉ để chạy tác dụng phụ
SIDE_RE = re.compile(r"""(?:^|[\n;])[ \t]*import[ \t]*(['"])(.+?)\1""")
# import() động — cấm, vì loader không theo dõi được
DYN_RE = re.compile(r"""\bimport\s*\(""")

LINK_RE = re.compile(r"""<link\b[^>]*\brel=["']stylesheet["'][^>]*>""", re.I)
HREF_RE = re.compile(r"""\bhref=["']([^"']+)["']""", re.I)

PLACEHOLDER = "__AM_MOD_{}__"


def die(msg):
    print("LOI: " + msg, file=sys.stderr)
    sys.exit(1)


def resolve(spec, importer):
    """Đổi specifier trong mã nguồn thành đường dẫn tính từ gốc dự án."""
    if spec in BARE:
        return BARE[spec]
    if not spec.startswith("."):
        die("Khong giai duoc specifier %r trong %s. Neu day la thu vien moi, "
            "them vao BARE trong tools/build.py." % (spec, importer))
    parts = []
    for p in str(PurePosixPath(importer).parent / spec).split("/"):
        if p in ("", "."):
            continue
        if p == "..":
            if parts:
                parts.pop()
        else:
            parts.append(p)
    return "/".join(parts)


def strip_comments(code):
    """Bỏ comment để kiểm tra import() động không bị báo nhầm vì chữ trong comment.
    Chỉ dùng cho việc KIỂM TRA, mã nhúng vào HTML vẫn là bản gốc."""
    code = re.sub(r"/\*.*?\*/", "", code, flags=re.S)
    return re.sub(r"(^|[^:])//[^\n]*", r"\1", code)


def collect(entry):
    """Duyệt đồ thị phụ thuộc, trả về thứ tự nạp (phụ thuộc đứng trước) và mã đã đánh dấu."""
    mods, state, order = {}, {}, []

    def visit(mid, stack):
        if state.get(mid) == "done":
            return
        if state.get(mid) == "visiting":
            die("Phu thuoc vong: " + " -> ".join(stack + [mid]))
        state[mid] = "visiting"

        path = ROOT / mid
        if not path.exists():
            die("Thieu file: %s (duoc nhap tu %s)" % (mid, stack[-1] if stack else "(goc)"))
        code = path.read_text(encoding="utf-8")

        if not mid.startswith("vendor/") and DYN_RE.search(strip_comments(code)):
            die("%s dung import() dong. build.py chi ho tro import tinh." % mid)

        spans = []
        for rx in (FROM_RE, SIDE_RE):
            for m in rx.finditer(code):
                spans.append((m.start(2), m.end(2), m.group(2)))
        spans.sort()

        deps = []
        for _, _, spec in spans:
            dep = resolve(spec, mid)
            if dep not in deps:
                deps.append(dep)
        for dep in deps:
            visit(dep, stack + [mid])

        # Thay từ cuối về đầu để các vị trí phía trước không bị xê dịch
        for start, end, spec in reversed(spans):
            code = code[:start] + PLACEHOLDER.format(resolve(spec, mid)) + code[end:]

        mods[mid] = code
        state[mid] = "done"
        order.append(mid)

    visit(entry, [])
    return order, mods


def inline_css(html, html_path):
    base = html_path.parent

    def repl(m):
        tag = m.group(0)
        h = HREF_RE.search(tag)
        if not h:
            return tag
        href = h.group(1)
        if re.match(r"^[a-z]+:", href, re.I):
            die("Stylesheet ngoai mang khong duoc phep: %s" % href)
        css_path = (base / href).resolve()
        if not css_path.exists():
            die("Thieu file CSS: %s" % href)
        css = css_path.read_text(encoding="utf-8").replace("</", "<\\/")
        return "<style>/* %s */\n%s</style>" % (href, css)

    return LINK_RE.sub(repl, html)


LOADER = """
(function () {
  var box = document.getElementById('__am_app__');
  var M = JSON.parse(box.textContent);
  var urls = {};
  try {
    for (var i = 0; i < M.order.length; i++) {
      var id = M.order[i], code = M.mods[id];
      for (var k = 0; k < i; k++) {
        var dep = M.order[k], ph = '__AM_MOD_' + dep + '__';
        if (code.indexOf(ph) >= 0) code = code.split(ph).join(urls[dep]);
      }
      urls[id] = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    }
    import(urls[M.entry]).catch(report);
  } catch (e) { report(e); }
  function report(e) {
    document.body.innerHTML =
      '<pre style="color:#e8c9a0;background:#050405;padding:24px;font:13px monospace;' +
      'white-space:pre-wrap">Could not start the application:\\n\\n' +
      String(e && e.stack || e) + '</pre>';
  }
})();
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--html", default="index.html")
    ap.add_argument("--entry", default="src/main.js")
    ap.add_argument("--out", default="dist/aether-mechanica.html")
    a = ap.parse_args()

    entry = a.entry.replace("\\", "/")
    html_path = ROOT / a.html
    out = ROOT / a.out

    order, mods = collect(entry)

    payload = json.dumps({"entry": entry, "order": order, "mods": mods},
                         ensure_ascii=False, separators=(",", ":"))
    # "</script" nằm trong mã nguồn sẽ cắt ngang thẻ script; "\/" là escape hợp lệ của JSON
    payload = payload.replace("</", "<\\/")

    html = html_path.read_text(encoding="utf-8")
    if "<!--APP:START-->" not in html or "<!--APP:END-->" not in html:
        die("%s thieu moc <!--APP:START--> / <!--APP:END-->" % a.html)

    html = inline_css(html, html_path)

    inline = ('<script type="application/json" id="__am_app__">' + payload + "</script>\n"
              "<script>" + LOADER + "</script>")
    html = re.sub(r"<!--APP:START-->.*?<!--APP:END-->", lambda _: inline, html, flags=re.S)

    # Bảo đảm offline: không còn thuộc tính src/href trỏ ra mạng trong khung HTML
    # (chỉ xét phần ngoài payload, vì trong mã three.js có chuỗi URL tài liệu vô hại)
    shell = html.replace(payload, "")
    ext = re.findall(r"""\b(?:src|href)\s*=\s*["']\s*(https?:)?//""", shell, re.I)
    if ext:
        die("Con tham chieu ra mang trong HTML (src/href http/https). Build bi huy.")

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")

    print("Da gop %d module -> %s" % (len(order), out))
    print("Kich thuoc: {:,} bytes".format(out.stat().st_size))


if __name__ == "__main__":
    main()
