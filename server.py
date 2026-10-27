"""Local web server: serves static/ and a small JSON API.  Standard library only."""
from __future__ import annotations

import argparse
import json
import mimetypes
import sys
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import analysis as A

STATIC = (Path(__file__).parent / "static").resolve()
MAX_BODY = 80 * 1024 * 1024

ROUTES = {
    "/api/prepare": lambda b: A.prepare(b.get("image")),
    "/api/grid": A.grid_api,
    "/api/analyze": lambda b: A.analyze(b.get("image"), b.get("config")),
    "/api/calibrate": A.fit_calibration,
    "/api/presets": lambda b: A.ASSAYS,
}


class Handler(BaseHTTPRequestHandler):
    server_version = "PlateOD/1.0"

    def log_message(self, fmt, *args):
        sys.stderr.write("%s  %s\n" % (self.address_string(), fmt % args))

    def _send(self, code, body: bytes, ctype: str):
        try:
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _json(self, code, obj):
        self._send(code, json.dumps(A.clean(obj)).encode("utf-8"), "application/json; charset=utf-8")

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/":
            path = "/index.html"
        f = (STATIC / path.lstrip("/")).resolve()
        if f != STATIC and STATIC not in f.parents or not f.is_file():
            return self._json(404, {"error": "Not found"})
        ctype = mimetypes.guess_type(f.name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
            ctype += "; charset=utf-8"
        self._send(200, f.read_bytes(), ctype)

    def do_POST(self):
        fn = ROUTES.get(self.path.split("?", 1)[0])
        if fn is None:
            return self._json(404, {"error": "Unknown endpoint"})
        try:
            n = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return self._json(400, {"error": "Bad Content-Length"})
        if n <= 0:
            if self.path.split("?", 1)[0] == "/api/presets":
                return self._json(200, fn({}))
            return self._json(400, {"error": "Empty request"})
        if n > MAX_BODY:
            return self._json(413, {"error": "Image too large (limit 80 MB)."})
        try:
            body = json.loads(self.rfile.read(n))
            if not isinstance(body, dict):
                raise A.AnalysisError("Request body must be a JSON object.")
            self._json(200, fn(body))
        except json.JSONDecodeError:
            self._json(400, {"error": "Request was not valid JSON."})
        except A.AnalysisError as e:
            self._json(400, {"error": str(e)})
        except Exception as e:  # never crash the server on one bad request
            traceback.print_exc()
            self._json(500, {"error": f"Internal error: {type(e).__name__}: {e}"})


def make_server(host="127.0.0.1", port=8000) -> ThreadingHTTPServer:
    return ThreadingHTTPServer((host, port), Handler)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="ELISA plate OD analyzer")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8000)
    a = ap.parse_args()
    srv = make_server(a.host, a.port)
    print(f"Open http://{a.host}:{a.port}  (Ctrl+C to stop)")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
