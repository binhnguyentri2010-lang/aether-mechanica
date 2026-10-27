#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Kiểm ranh giới import giữa code dùng chung và code riêng của từng mẫu vật.

Luật (plan đợt 3, §1):
  1. src/components/, src/core/, src/model/, src/motion/  KHÔNG được import từ src/specimens/.
     (Chúng nhận mẫu hiện tại qua tham số / registry, không biết con nào là con nào.)
  2. src/specimens/<a>/ KHÔNG được import từ src/specimens/<b>/ (a ≠ b).
  3. Chỉ src/main.js (và tests/) được import src/specimens/index.js — registry.
  4. Không file nào trong src/ import catalog cũ src/model/catalog.js (đã chuyển vào mẫu vật).

Chỉ dùng thư viện chuẩn. Thoát mã 1 nếu có vi phạm.

Chạy:  python tools\\check_boundaries.py
"""

import re
import sys
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"

IMPORT_RE = re.compile(r"""(?:^|[\n;])[ \t]*(?:import|export)\b[^'"();]*?\bfrom[ \t]*(['"])(.+?)\1""")
SIDE_RE = re.compile(r"""(?:^|[\n;])[ \t]*import[ \t]*(['"])(.+?)\1""")

SHARED = ("src/components/", "src/core/", "src/model/", "src/motion/")


def rel(p):
    return p.relative_to(ROOT).as_posix()


def resolve(spec, importer):
    if not spec.startswith("."):
        return None  # 'three' và các bare specifier khác
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


def specimen_of(path):
    m = re.match(r"src/specimens/([^/]+)/", path)
    return m.group(1) if m else None


def main():
    bad = []
    files = sorted(SRC.rglob("*.js"))
    for f in files:
        me = rel(f)
        code = f.read_text(encoding="utf-8")
        specs = [m.group(2) for rx in (IMPORT_RE, SIDE_RE) for m in rx.finditer(code)]
        for spec in specs:
            dep = resolve(spec, me)
            if dep is None:
                continue
            if dep == "src/model/catalog.js":
                bad.append("%s -> %s (catalog cu, phai nam trong specimens/<mau>/)" % (me, dep))
            if me.startswith(SHARED) and dep.startswith("src/specimens/"):
                bad.append("%s -> %s (code dung chung khong duoc import mau vat)" % (me, dep))
            sa, sb = specimen_of(me), specimen_of(dep)
            if sa and sb and sa != sb:
                bad.append("%s -> %s (mau vat nay import mau vat khac)" % (me, dep))
            if dep == "src/specimens/index.js" and me != "src/main.js":
                bad.append("%s -> %s (chi main.js duoc dung registry)" % (me, dep))
    if bad:
        print("VI PHAM RANH GIOI (%d):" % len(bad))
        for b in bad:
            print("  " + b)
        sys.exit(1)
    print("Ranh gioi sach: %d file trong src/, 0 vi pham." % len(files))


if __name__ == "__main__":
    main()
