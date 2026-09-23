"""Local web UI for the simulator; no third-party dependencies."""
import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from simulator import baseline, evaluate, load_data
from conclusions import build_conclusion

ROOT = Path(__file__).resolve().parent
STATIC = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/app.css": ("app.css", "text/css; charset=utf-8"),
    "/conclusion.css": ("conclusion.css", "text/css; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
}


class Handler(BaseHTTPRequestHandler):
    def send_bytes(self, content, mime, status=200):
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(content)

    def send_json(self, value, status=200):
        self.send_bytes(json.dumps(value, ensure_ascii=False).encode("utf-8"),
                        "application/json; charset=utf-8", status)

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/api/data":
            self.send_json({"data": load_data(), "baseline": baseline(),
                            "example": json.loads((ROOT / "examples" / "organizer.json").read_text(encoding="utf-8"))})
        elif path in STATIC:
            filename, mime = STATIC[path]
            self.send_bytes((ROOT / "web" / filename).read_bytes(), mime)
        else:
            self.send_json({"error": "Страница не найдена."}, 404)

    def do_POST(self):
        if self.path != "/api/evaluate":
            self.send_json({"error": "Страница не найдена."}, 404)
            return
        origin = self.headers.get("Origin")
        if origin and origin != "http://" + self.headers.get("Host", ""):
            self.send_json({"error": "Запрос с другого сайта запрещён."}, 403)
            return
        if self.headers.get_content_type() != "application/json":
            self.send_json({"error": "Ожидается JSON."}, 415)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 32768:
                self.send_json({"error": "Недопустимый размер запроса."}, 413)
                return
            decisions = json.loads(self.rfile.read(length))
        except (ValueError, UnicodeError):
            self.send_json({"error": "Не удалось прочитать JSON."}, 400)
            return
        result = evaluate(decisions)
        if result["valid"]:
            result["conclusion"] = build_conclusion(decisions, result)
        self.send_json(result, 200 if result["valid"] else 422)


def main():
    parser = argparse.ArgumentParser(description="Локальный интерфейс «Аким на 5 часов»")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"Open http://127.0.0.1:{args.port} in your browser. Ctrl+C to stop.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
