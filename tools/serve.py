#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Máy chủ phát triển. Chỉ dùng thư viện chuẩn Python.

Chạy:  python tools\\serve.py              → http://localhost:8080
       python tools\\serve.py 9000         → đổi cổng
       python tools\\serve.py --lan        → mở cho iPhone/iPad cùng Wi-Fi

Hai việc nó làm mà http.server trần không làm:

1. ÉP KIỂU MIME CỦA .js. Trên Windows, mimetypes đọc registry, và máy nào cài nhầm phần
   mềm là .js hoá ra text/plain — trình duyệt lập tức từ chối nạp ES module.
2. TẮT CACHE. Sửa module xong bấm F5 mà trình duyệt vẫn chạy bản cũ là cái bẫy kinh điển.

--lan chỉ đổi địa chỉ lắng nghe sang 0.0.0.0 để máy khác trong mạng nhà mở được. Nó chỉ
phục vụ đúng thư mục dự án này. IP LAN lấy từ tên máy, không gửi gói tin nào ra ngoài.
"""

import json
import mimetypes
import re
import socket
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("application/json", ".json")
mimetypes.add_type("image/svg+xml", ".svg")


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".json": "application/json",
        ".html": "text/html",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        "": "application/octet-stream",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        msg = fmt % args
        if " 200 " in msg or " 304 " in msg or " 204 " in msg:
            return  # chỉ in lỗi, đỡ rác màn hình
        sys.stderr.write("  %s\n" % msg)

    # ── Ghi ảnh golden cho selftest (chỉ dev) ─────────────────────────────────────────────────
    # PUT /__golden/<ten>.png → tests/golden/<ten>.png. Chỉ bật khi máy chủ nghe trên 127.0.0.1
    # (tắt hẳn với --lan), tên file chặt chẽ, phải là PNG, tối đa 8 MB. Không ghi được chỗ nào khác.
    # Ngoại lệ duy nhất: /__golden/meta.json (≤ 64 KB, phải là object JSON) — ghi GPU/cấu hình lúc chụp.
    # PUT /__bench/result.json → tests/bench-result.json (tests/bench.html) và /__bench/profile.json →
    # tests/profile-result.json (tests/profile.html): lưu kết quả lần đo gần nhất (object JSON ≤ 256 KB) để
    # đối chiếu sau mà không phải chép tay từ màn hình. Cùng điều kiện 127.0.0.1.
    def do_PUT(self):
        if not getattr(self.server, "allow_golden", False):
            self.send_error(403, "Golden upload chi bat khi chay tren 127.0.0.1")
            return
        bench = BENCH_PATHS.get(self.path)
        if bench:
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0 or length > 256 * 1024:
                self.send_error(413)
                return
            data = self.rfile.read(length)
            try:
                ok = isinstance(json.loads(data.decode("utf-8")), dict)
            except ValueError:
                ok = False
            if not ok:
                self.send_error(400, "Ket qua bench phai la object JSON")
                return
            (ROOT / "tests" / bench).write_bytes(data)
            self.send_response(204)
            self.end_headers()
            return
        m = GOLDEN_PATH.fullmatch(self.path)
        if not m:
            self.send_error(404)
            return
        is_meta = m.group(1) == "meta.json"
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > (64 * 1024 if is_meta else 8 * 1024 * 1024):
            self.send_error(413)
            return
        data = self.rfile.read(length)
        if is_meta:
            try:
                ok = isinstance(json.loads(data.decode("utf-8")), dict)
            except ValueError:
                ok = False
            if not ok:
                self.send_error(400, "meta.json phai la object JSON")
                return
        elif not data.startswith(b"\x89PNG\r\n\x1a\n"):
            self.send_error(400, "Khong phai PNG")
            return
        GOLDEN_DIR.mkdir(parents=True, exist_ok=True)
        (GOLDEN_DIR / m.group(1)).write_bytes(data)
        self.send_response(204)
        self.end_headers()


BENCH_PATHS = {
    "/__bench/result.json": "bench-result.json",
    "/__bench/profile.json": "profile-result.json",
    "/__bench/probe.json": "probe-result.json",
}
GOLDEN_DIR = ROOT / "tests" / "golden"
GOLDEN_PATH = re.compile(r"/__golden/([a-z0-9][a-z0-9\-]{0,80}\.png|meta\.json)")


def lan_addresses():
    try:
        _, _, addrs = socket.gethostbyname_ex(socket.gethostname())
    except OSError:
        return []
    return [a for a in addrs if not a.startswith("127.")]


def main():
    args = [a for a in sys.argv[1:]]
    lan = "--lan" in args
    args = [a for a in args if a != "--lan"]
    port = int(args[0]) if args else 8080

    host = "0.0.0.0" if lan else "127.0.0.1"
    handler = partial(Handler, directory=str(ROOT))
    server = ThreadingHTTPServer((host, port), handler)
    server.allow_golden = not lan

    print("Ung dung:  http://localhost:%d/" % port)
    print("Test:      http://localhost:%d/tests/" % port)
    if lan:
        ips = lan_addresses()
        if ips:
            print("Tren iPhone/iPad (cung Wi-Fi), thu lan luot:")
            for ip in ips:
                print("           http://%s:%d/" % (ip, port))
        else:
            print("Khong tim thay IP LAN. Chay 'ipconfig' de xem dia chi IPv4.")
        print("Windows Firewall co the hoi: chon cho phep o mang Private.")
    print("Ctrl+C de dung.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nDa dung.")
        server.server_close()


if __name__ == "__main__":
    main()
