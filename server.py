#!/usr/bin/env python3
"""Serve the DSA tracker and persist progress to data/progress.json."""

from __future__ import annotations

import json
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PROGRESS_FILE = ROOT / "data" / "progress.json"

DEFAULT_PROGRESS = {
    "version": 3,
    "problems": {},
    "weak": {},
    "solutions": {},
    "currentSet": [],
    "revision": [],
    "revisionDate": None,
    "setHistory": [],
    "history": {},
    "streak": 0,
    "lastActiveDate": None,
}


def read_progress() -> dict:
    if not PROGRESS_FILE.exists():
        return json.loads(json.dumps(DEFAULT_PROGRESS))
    with PROGRESS_FILE.open("r", encoding="utf-8") as fh:
        data = json.load(fh)
    if not isinstance(data, dict):
        return json.loads(json.dumps(DEFAULT_PROGRESS))
    merged = json.loads(json.dumps(DEFAULT_PROGRESS))
    merged.update(data)
    return merged


def write_progress(data: dict) -> None:
    PROGRESS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with PROGRESS_FILE.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False)
        fh.write("\n")


class TrackerHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self) -> None:
        if self.path == "/api/progress":
            self._send_json(read_progress())
            return
        super().do_GET()

    def do_PUT(self) -> None:
        if self.path != "/api/progress":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        try:
            data = json.loads(body.decode("utf-8"))
        except json.JSONDecodeError:
            self.send_error(400, "Invalid JSON")
            return
        if not isinstance(data, dict):
            self.send_error(400, "Expected JSON object")
            return
        write_progress(data)
        self._send_json({"ok": True})

    def log_message(self, fmt: str, *args) -> None:
        if self.path.startswith("/api/"):
            super().log_message(fmt, *args)

    def _send_json(self, payload: dict) -> None:
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    server = ThreadingHTTPServer(("127.0.0.1", port), TrackerHandler)
    print(f"DSA Tracker running at http://127.0.0.1:{port}/index.html")
    print(f"Progress file: {PROGRESS_FILE}")
    server.serve_forever()


if __name__ == "__main__":
    main()
