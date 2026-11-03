#!/usr/bin/env python3
"""
frontend_checks/check_contract.py

Validates static/ frontend code against FRONTEND_CONTRACT.md and AGENT_RULES.md:
1. Every contract element ID is present in static/index.html or static/js/.
2. Every contract API endpoint is defined in static/js/api.js.
3. No 'text-shadow' appears anywhere in static/.
4. No decorative numbering ('01 /', 'Step 1', 'Step 2') appears in UI text or strings.
5. No 'innerHTML' with dynamic data patterns appear.
6. No emojis appear in static/.
"""

import os
import re
import sys
from pathlib import Path

# Ensure UTF-8 output on Windows
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
STATIC_DIR = ROOT / "static"
CONTRACT_PATH = ROOT / "FRONTEND_CONTRACT.md"


def check_contract():
    errors = []
    print("=== Running Frontend Contract & Rule Checks ===")

    # 1. Parse FRONTEND_CONTRACT.md
    if not CONTRACT_PATH.exists():
        return ["FRONTEND_CONTRACT.md not found!"]

    contract_text = CONTRACT_PATH.read_text(encoding="utf-8")

    # Extract IDs: - `id-name`
    contract_ids = re.findall(r"^-\s*`([a-zA-Z0-9_\-]+)`", contract_text, re.MULTILINE)
    print(f"Contract IDs defined: {len(contract_ids)}")

    # Extract Endpoints: `POST /api/...` or `GET /...`
    contract_endpoints = re.findall(r"`(?:GET|POST)\s+(/[a-zA-Z0-9_/]*)`", contract_text)
    contract_endpoints = sorted(list(set(contract_endpoints)))
    print(f"Contract Endpoints defined: {len(contract_endpoints)}")

    # 2. Check IDs in static/index.html and static/js/*.js
    index_html_path = STATIC_DIR / "index.html"
    index_html = index_html_path.read_text(encoding="utf-8")
    html_ids = set(re.findall(r'\bid=["\']([^"\']+)["\']', index_html))

    js_code = ""
    for jf in (STATIC_DIR / "js").glob("*.js"):
        js_code += jf.read_text(encoding="utf-8", errors="ignore") + "\n"

    missing_ids = []
    for cid in contract_ids:
        in_html = cid in html_ids
        in_js = (f'"{cid}"' in js_code) or (f"'{cid}'" in js_code) or (f"`{cid}`" in js_code)
        if not in_html and not in_js:
            missing_ids.append(cid)

    if missing_ids:
        errors.append(f"Missing {len(missing_ids)} contract IDs: {', '.join(missing_ids[:10])}...")
    else:
        print(f"All {len(contract_ids)} contract IDs verified present.")

    # 3. Check Endpoints in static/js/api.js (and other js files)
    missing_endpoints = []
    for ep in contract_endpoints:
        if ep == "/":
            if '"/"' not in js_code and "'/'" not in js_code:
                missing_endpoints.append(ep)
        else:
            if ep not in js_code:
                missing_endpoints.append(ep)

    if missing_endpoints:
        errors.append(f"Missing contract endpoints in JS: {', '.join(missing_endpoints)}")
    else:
        print(f"All {len(contract_endpoints)} endpoints verified in static/js/.")

    # 4. Check for 'text-shadow' across static/
    for ext in ("*.css", "*.html", "*.js"):
        for p in STATIC_DIR.rglob(ext):
            content = p.read_text(encoding="utf-8", errors="ignore")
            if "text-shadow" in content:
                rel = p.relative_to(ROOT)
                errors.append(f"Forbidden 'text-shadow' found in {rel}")

    # 5. Check for decorative numbering ('01 /', 'Step 1', 'Step 2') in UI text and strings
    step_pattern = re.compile(r'\b(?:Step\s+[1-9]|0[1-9]\s*/)\b', re.IGNORECASE)

    # In HTML: check user-facing text between tags
    for p in STATIC_DIR.rglob("*.html"):
        for i, line in enumerate(p.read_text(encoding="utf-8", errors="ignore").splitlines(), 1):
            # Strip tags and attributes: only check text content
            text_only = re.sub(r'<[^>]+>', ' ', line)
            if step_pattern.search(text_only):
                rel = p.relative_to(ROOT)
                errors.append(f"Decorative numbering found in {rel}:{i} -> {line.strip()[:80]}")

    # In JS: check string literals only (not code comments)
    str_literal_pattern = re.compile(r'(?:["\'`])([^"\'`]*\b(?:Step\s+[1-9]|0[1-9]\s*/)\b[^"\'`]*)(?:["\'`])', re.IGNORECASE)
    for p in (STATIC_DIR / "js").glob("*.js"):
        for i, line in enumerate(p.read_text(encoding="utf-8", errors="ignore").splitlines(), 1):
            code_line = line.split("//")[0].strip()  # ignore inline comments
            if str_literal_pattern.search(code_line):
                rel = p.relative_to(ROOT)
                errors.append(f"Decorative numbering string found in {rel}:{i} -> {line.strip()[:80]}")

    # 6. Check for innerHTML with dynamic data
    # Safe: el.innerHTML = "" or static template strings without interpolation or concatenation
    inner_html_pattern = re.compile(r'\.innerHTML\s*=\s*(?:[`"\'].*\$\{.*\}|.*[+].*)')
    for p in (STATIC_DIR / "js").glob("*.js"):
        for i, line in enumerate(p.read_text(encoding="utf-8", errors="ignore").splitlines(), 1):
            if ".innerHTML" in line:
                if inner_html_pattern.search(line):
                    rel = p.relative_to(ROOT)
                    errors.append(f"Unsafe innerHTML with dynamic data in {rel}:{i} -> {line.strip()[:80]}")

    # 7. Check for emojis in static/
    emoji_pattern = re.compile(r'[\U00010000-\U0010ffff]', flags=re.UNICODE)
    for ext in ("*.html", "*.js", "*.css"):
        for p in STATIC_DIR.rglob(ext):
            for i, line in enumerate(p.read_text(encoding="utf-8", errors="ignore").splitlines(), 1):
                if emoji_pattern.search(line):
                    rel = p.relative_to(ROOT)
                    errors.append(f"Emoji found in {rel}:{i} -> {line.strip()[:80]}")

    return errors


if __name__ == "__main__":
    errs = check_contract()
    if errs:
        print("\n[FAIL] CONTRACT CHECK FAILED:")
        for e in errs:
            print(f"  - {e}")
        sys.exit(1)
    else:
        print("\n[PASS] Contract and safeguard check PASSED cleanly! All rules satisfied.")
        sys.exit(0)
