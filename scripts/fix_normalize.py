#!/usr/bin/env python3
"""One-off: make the accent-stripping regex use explicit unicode escapes."""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
path = os.path.join(ROOT, "app.js")
with open(path, encoding="utf-8") as f:
    src = f.read()

old = ".replace(/[̀-ͯ]/g, '') // strip accents"
new = ".replace(/[\\u0300-\\u036f]/g, '') // strip accents"
if old not in src:
    raise SystemExit("anchor not found; maybe already fixed")
src = src.replace(old, new)
with open(path, "w", encoding="utf-8") as f:
    f.write(src)
print("fixed")
