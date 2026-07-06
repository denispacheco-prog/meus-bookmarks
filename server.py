#!/usr/bin/env python3
"""Servidor local para o Meus Bookmarks.

Serve o frontend estático (pasta docs/) e expõe uma pequena API
que lê e grava em data/bookmarks.json. Uso local apenas: no GitHub
Pages o mesmo frontend fala direto com a API do GitHub em vez desta API.
"""

import json
import uuid
from datetime import datetime, timezone
from functools import partial
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

ROOT = Path(__file__).parent
PUBLIC_DIR = ROOT / "docs"
DATA_FILE = ROOT / "data" / "bookmarks.json"
PORT = 8000
IMPORT_TAG = "import"


def read_bookmarks():
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def write_bookmarks(data):
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def clean_list_field(raw_values):
    if isinstance(raw_values, str):
        raw_values = raw_values.split(",")
    seen = []
    for value in raw_values or []:
        value = str(value).strip()
        if value and value not in seen:
            seen.append(value)
    return seen


def merge_known_categories(data, new_categories):
    known = data.setdefault("categories", [])
    for category in new_categories:
        if category not in known:
            known.append(category)


def build_bookmark(raw_item, extra_tags=None):
    url = (raw_item.get("url") or "").strip()
    title = (raw_item.get("title") or "").strip()
    if not url or not title:
        return None

    tags = clean_list_field(raw_item.get("tags"))
    for tag in extra_tags or []:
        if tag not in tags:
            tags.append(tag)

    return {
        "id": str(uuid.uuid4()),
        "url": url,
        "title": title,
        "description": (raw_item.get("description") or "").strip(),
        "tags": tags,
        "categories": clean_list_field(raw_item.get("categories")),
        "createdAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z",
    }


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PUBLIC_DIR), **kwargs)

    def log_message(self, format, *args):
        print("[%s] %s" % (self.log_date_time_string(), format % args))

    def _send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/api/bookmarks":
            try:
                data = read_bookmarks()
            except (OSError, json.JSONDecodeError) as exc:
                self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)})
                return
            self._send_json(HTTPStatus.OK, data)
            return
        super().do_GET()

    def do_POST(self):
        if self.path == "/api/bookmarks":
            self._handle_create()
        elif self.path == "/api/import":
            self._handle_import()
        else:
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})

    def do_PUT(self):
        bookmark_id = self._extract_bookmark_id()
        if bookmark_id is None:
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            return
        self._handle_update(bookmark_id)

    def do_DELETE(self):
        bookmark_id = self._extract_bookmark_id()
        if bookmark_id is None:
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            return
        self._handle_delete(bookmark_id)

    def _extract_bookmark_id(self):
        prefix = "/api/bookmarks/"
        if not self.path.startswith(prefix):
            return None
        bookmark_id = self.path[len(prefix):]
        return bookmark_id or None

    def _read_json_body(self):
        length = int(self.headers.get("Content-Length", 0))
        raw_body = self.rfile.read(length) if length else b""
        return json.loads(raw_body or "{}")

    def _handle_create(self):
        try:
            payload = self._read_json_body()
        except json.JSONDecodeError:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "JSON inválido"})
            return

        new_bookmark = build_bookmark(payload)
        if new_bookmark is None:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "url e title são obrigatórios"})
            return

        try:
            data = read_bookmarks()
        except (OSError, json.JSONDecodeError) as exc:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)})
            return

        data.setdefault("bookmarks", []).append(new_bookmark)
        merge_known_categories(data, new_bookmark["categories"])
        write_bookmarks(data)

        self._send_json(HTTPStatus.CREATED, new_bookmark)

    def _handle_import(self):
        try:
            payload = self._read_json_body()
        except json.JSONDecodeError:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "JSON inválido"})
            return

        raw_items = payload.get("bookmarks") if isinstance(payload, dict) else payload
        if not isinstance(raw_items, list):
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "esperava um array de bookmarks (ou {\"bookmarks\": [...]})"})
            return

        try:
            data = read_bookmarks()
        except (OSError, json.JSONDecodeError) as exc:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)})
            return

        existing_urls = {b["url"] for b in data.setdefault("bookmarks", [])}
        imported = []
        skipped = 0
        invalid = 0

        for raw_item in raw_items:
            if not isinstance(raw_item, dict):
                invalid += 1
                continue
            bookmark = build_bookmark(raw_item, extra_tags=[IMPORT_TAG])
            if bookmark is None:
                invalid += 1
                continue
            if bookmark["url"] in existing_urls:
                skipped += 1
                continue
            existing_urls.add(bookmark["url"])
            imported.append(bookmark)
            merge_known_categories(data, bookmark["categories"])

        data["bookmarks"].extend(imported)
        write_bookmarks(data)

        self._send_json(HTTPStatus.OK, {
            "importedCount": len(imported),
            "skippedCount": skipped,
            "invalidCount": invalid,
            "imported": imported,
        })

    def _handle_update(self, bookmark_id):
        try:
            payload = self._read_json_body()
        except json.JSONDecodeError:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "JSON inválido"})
            return

        url = (payload.get("url") or "").strip()
        title = (payload.get("title") or "").strip()
        if not url or not title:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "url e title são obrigatórios"})
            return

        try:
            data = read_bookmarks()
        except (OSError, json.JSONDecodeError) as exc:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)})
            return

        bookmarks = data.setdefault("bookmarks", [])
        target = next((b for b in bookmarks if b["id"] == bookmark_id), None)
        if target is None:
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "bookmark não encontrado"})
            return

        categories = clean_list_field(payload.get("categories"))
        target["url"] = url
        target["title"] = title
        target["description"] = (payload.get("description") or "").strip()
        target["tags"] = clean_list_field(payload.get("tags"))
        target["categories"] = categories
        merge_known_categories(data, categories)
        write_bookmarks(data)

        self._send_json(HTTPStatus.OK, target)

    def _handle_delete(self, bookmark_id):
        try:
            data = read_bookmarks()
        except (OSError, json.JSONDecodeError) as exc:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)})
            return

        bookmarks = data.setdefault("bookmarks", [])
        remaining = [b for b in bookmarks if b["id"] != bookmark_id]
        if len(remaining) == len(bookmarks):
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "bookmark não encontrado"})
            return

        data["bookmarks"] = remaining
        write_bookmarks(data)
        self._send_json(HTTPStatus.OK, {"deleted": bookmark_id})


def main():
    handler = partial(Handler)
    server = ThreadingHTTPServer(("127.0.0.1", PORT), handler)
    print(f"Meus Bookmarks rodando em http://127.0.0.1:{PORT}")
    print("Ctrl+C para parar.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
