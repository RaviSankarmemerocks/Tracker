#!/usr/bin/env python3
"""Rebuild tracker-data.js/json from DSA.html (excludes basics + sorting)."""

import re
import json
from pathlib import Path
from html import unescape
from collections import OrderedDict

EXCLUDE_MAIN = {
    "Learn the basics",
    "Learn Important Sorting Techniques",
}

ROOT = Path(__file__).resolve().parent.parent
HTML = ROOT / "DSA.html"


def clean_text(s):
    t = unescape(re.sub(r"<[^>]+>", " ", s))
    return re.sub(r"\s+", " ", t).strip()


def parse_row(row):
    checked = bool(re.search(r'name="complete"[^>]*checked|checked[^>]*name="complete"', row))
    m = re.search(
        r'w-\[25%\][^>]*>.*?<(?:a[^>]*>([^<]+)</a>|span>([^<]+)</span>)',
        row,
        re.DOTALL,
    )
    name = (m.group(1) or m.group(2)).strip() if m else None
    dm = re.search(r"difficulty-badge--(\w+)[^>]*>(\w+)<", row)
    diff = dm.group(2).capitalize() if dm else None
    lc = re.search(r'href="(https://leetcode\.com/[^"]+)"', row)
    tuf = re.search(r'href="(https://takeuforward\.org/plus/dsa/problems/[^"]+)"', row)
    post = re.search(r'href="(https://takeuforward\.org/data-structure/[^"]+)"', row)
    pid = re.search(r'id="(\d+)" class="sheet-checkbox"', row)
    if not name:
        return None
    slug = re.sub(r"[^a-z0-9]+", "-", unescape(name).lower()).strip("-")
    uid = pid.group(1) if pid else slug
    return {
        "id": uid,
        "name": unescape(name),
        "difficulty": diff,
        "sheetCompleted": checked,
        "leetcode": lc.group(1) if lc else None,
        "tuf": tuf.group(1) if tuf else None,
        "article": post.group(1) if post else None,
    }


def main():
    content = HTML.read_text()
    main_sections = [
        {"title": clean_text(m.group(1)), "start": m.start()}
        for m in re.finditer(r'<span class="tuf-accordion-title[^"]*">(.*?)</span>', content, re.DOTALL)
    ]
    sub_sections = []
    for m in re.finditer(
        r'<button[^>]*class="[^"]*tuf-subrow-btn[^"]*"[^>]*>(.*?)</button>\s*<div class="tuf-subrow-panel',
        content,
        re.DOTALL,
    ):
        inner = m.group(1)
        title_m = re.search(r"<span[^>]*>(.*?)</span>\s*<div class=\"flex items-center", inner, re.DOTALL)
        sub_sections.append(
            {
                "title": clean_text(title_m.group(1)) if title_m else clean_text(inner),
                "start": m.start(),
            }
        )

    tables = [m.start() for m in re.finditer(r'<table class="table-auto w-full min-w-\[800px\]', content)]
    patterns = OrderedDict()
    all_problems = []

    for tstart in tables:
        sub = max([s for s in sub_sections if s["start"] < tstart], key=lambda s: s["start"], default={"title": "General"})
        main = max([s for s in main_sections if s["start"] < tstart], key=lambda s: s["start"], default={"title": "Other"})
        if main["title"] in EXCLUDE_MAIN:
            continue
        table_html = content[tstart : content.find("</table>", tstart) + 8]
        rows = re.findall(r'<tr class="border-t-2.*?</tr>', table_html, re.DOTALL)
        problems = [p for p in (parse_row(r) for r in rows) if p]
        key = main["title"]
        patterns.setdefault(key, OrderedDict())
        patterns[key].setdefault(sub["title"], [])
        for p in problems:
            patterns[key][sub["title"]].append(p)
            all_problems.append(p)

    out = {
        "meta": {
            "source": "Striver A2Z DSA Sheet",
            "excluded": sorted(EXCLUDE_MAIN),
            "dailyNew": 4,
            "dailyRevision": 4,
            "totalProblems": len(all_problems),
            "sheetCompletedCount": sum(1 for p in all_problems if p["sheetCompleted"]),
        },
        "patterns": patterns,
    }

    data_dir = ROOT / "data"
    data_dir.mkdir(exist_ok=True)
    (data_dir / "tracker-data.json").write_text(json.dumps(out, indent=2))
    (data_dir / "tracker-data.js").write_text("window.TRACKER_DATA = " + json.dumps(out) + ";\n")
    print(f"Built {len(all_problems)} problems across {len(patterns)} patterns")

    # skipped list for UI
    build_skipped(content, main_sections, sub_sections, tables, data_dir)


def build_skipped(content, main_sections, sub_sections, tables, data_dir):
    def skip_sub(name):
        n = name.lower()
        return n.startswith("introduction") or n.startswith("learn ") or n in ("learning", "theory", "concepts")

    def skip_prob_name(name):
        n = name.lower()
        return "| theory" in n or "(theory" in n or n.startswith("introduction to ")

    skipped = []
    for tstart in tables:
        sub = max([s for s in sub_sections if s["start"] < tstart], key=lambda s: s["start"], default={"title": "General"})
        main = max([s for s in main_sections if s["start"] < tstart], key=lambda s: s["start"], default={"title": "Other"})
        table_html = content[tstart : content.find("</table>", tstart) + 8]
        rows = re.findall(r'<tr class="border-t-2.*?</tr>', table_html, re.DOTALL)
        for p in (parse_row(r) for r in rows):
            if not p:
                continue
            p["pattern"] = main["title"]
            p["subsection"] = sub["title"]
            if main["title"] in EXCLUDE_MAIN:
                p["skipReason"] = "Excluded topic (basics/sorting)"
                skipped.append(p)
            elif skip_sub(sub["title"]):
                p["skipReason"] = f"Intro/learning subsection: {sub['title']}"
                skipped.append(p)
            elif skip_prob_name(p["name"]):
                p["skipReason"] = "Intro/theory problem name"
                skipped.append(p)

    payload = {"total": len(skipped), "problems": skipped}
    (data_dir / "skipped-problems.json").write_text(json.dumps(payload, indent=2))
    (data_dir / "skipped-problems.js").write_text("window.SKIPPED_DATA = " + json.dumps(payload) + ";\n")
    print(f"Built {len(skipped)} skipped problems")


if __name__ == "__main__":
    main()
