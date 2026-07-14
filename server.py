#!/usr/bin/env python3
"""Servidor local para o Meus Bookmarks.

Serve o frontend estático (pasta docs/) e expõe uma pequena API
que lê e grava em data/bookmarks.json. Uso local apenas: no GitHub
Pages o mesmo frontend fala direto com a API do GitHub em vez desta API.
"""

import html
import json
import re
import urllib.error
import urllib.parse
import urllib.request
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
TITLE_RE = re.compile(rb"<title[^>]*>(.*?)</title>", re.IGNORECASE | re.DOTALL)


def fetch_page_title(url):
    req = urllib.request.Request(
        url, headers={"User-Agent": "Mozilla/5.0 (compatible; MeusBookmarksBot/1.0)"}
    )
    with urllib.request.urlopen(req, timeout=6) as resp:
        raw = resp.read(200_000)
        charset = resp.headers.get_content_charset() or "utf-8"

    match = TITLE_RE.search(raw)
    if not match:
        return None
    try:
        title = match.group(1).decode(charset, errors="replace")
    except LookupError:
        title = match.group(1).decode("utf-8", errors="replace")
    title = html.unescape(title)
    title = re.sub(r"\s+", " ", title).strip()
    return title or None


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


def merge_known_categories(data, new_category_names, group_id):
    if not new_category_names or not group_id:
        return
    groups = data.setdefault("categoryGroups", [])
    known = {c for g in groups for c in g.get("categories", [])}
    target = next((g for g in groups if g.get("id") == group_id), None)
    if target is None:
        return
    for name in new_category_names:
        if name not in known:
            target["categories"].append(name)
            known.add(name)


def merge_known_actions(data, action):
    if not action:
        return
    known = data.setdefault("actions", [])
    if action not in known:
        known.append(action)


def _all_category_names(groups):
    return {c for g in groups for c in g.get("categories", [])}


def add_category(data, group_id, name):
    name = (name or "").strip()
    if not name:
        raise ValueError("nome da categoria é obrigatório")
    groups = data.setdefault("categoryGroups", [])
    target = next((g for g in groups if g.get("id") == group_id), None)
    if target is None:
        raise ValueError("grupo não encontrado")
    if name in _all_category_names(groups):
        raise ValueError("já existe uma categoria com esse nome")
    target["categories"].append(name)


def rename_category(data, group_id, old_name, new_name):
    new_name = (new_name or "").strip()
    if not new_name:
        raise ValueError("nome da categoria é obrigatório")
    groups = data.setdefault("categoryGroups", [])
    target = next((g for g in groups if g.get("id") == group_id), None)
    if target is None or old_name not in target.get("categories", []):
        raise ValueError("categoria não encontrada")
    if new_name != old_name and new_name in _all_category_names(groups):
        raise ValueError("já existe uma categoria com esse nome")

    target["categories"] = [new_name if c == old_name else c for c in target["categories"]]
    for bookmark in data.get("bookmarks", []):
        categories = bookmark.get("categories", [])
        if old_name in categories:
            bookmark["categories"] = clean_list_field(
                [new_name if c == old_name else c for c in categories]
            )


def delete_category(data, group_id, name):
    groups = data.setdefault("categoryGroups", [])
    target = next((g for g in groups if g.get("id") == group_id), None)
    if target is None or name not in target.get("categories", []):
        raise ValueError("categoria não encontrada")

    target["categories"] = [c for c in target["categories"] if c != name]
    for bookmark in data.get("bookmarks", []):
        if name in bookmark.get("categories", []):
            bookmark["categories"] = [c for c in bookmark["categories"] if c != name]


def add_action(data, name):
    name = (name or "").strip()
    if not name:
        raise ValueError("nome da ação é obrigatório")
    actions = data.setdefault("actions", [])
    if name in actions:
        raise ValueError("já existe uma ação com esse nome")
    actions.append(name)


def rename_action(data, old_name, new_name):
    new_name = (new_name or "").strip()
    if not new_name:
        raise ValueError("nome da ação é obrigatório")
    actions = data.setdefault("actions", [])
    if old_name not in actions:
        raise ValueError("ação não encontrada")
    if new_name != old_name and new_name in actions:
        raise ValueError("já existe uma ação com esse nome")

    data["actions"] = [new_name if a == old_name else a for a in actions]
    for bookmark in data.get("bookmarks", []):
        if bookmark.get("action") == old_name:
            bookmark["action"] = new_name


def delete_action(data, name):
    actions = data.setdefault("actions", [])
    if name not in actions:
        raise ValueError("ação não encontrada")

    data["actions"] = [a for a in actions if a != name]
    for bookmark in data.get("bookmarks", []):
        if bookmark.get("action") == name:
            bookmark["action"] = ""


def _all_tag_names(bookmarks):
    return {t for b in bookmarks for t in b.get("tags", [])}


def rename_tag(data, old_name, new_name):
    new_name = (new_name or "").strip()
    if not new_name:
        raise ValueError("nome da tag é obrigatório")
    bookmarks = data.get("bookmarks", [])
    if old_name not in _all_tag_names(bookmarks):
        raise ValueError("tag não encontrada")

    for bookmark in bookmarks:
        tags = bookmark.get("tags", [])
        if old_name in tags:
            bookmark["tags"] = clean_list_field(
                [new_name if t == old_name else t for t in tags]
            )


def delete_tag(data, name):
    bookmarks = data.get("bookmarks", [])
    if name not in _all_tag_names(bookmarks):
        raise ValueError("tag não encontrada")

    for bookmark in bookmarks:
        if name in bookmark.get("tags", []):
            bookmark["tags"] = [t for t in bookmark["tags"] if t != name]


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
        "action": (raw_item.get("action") or "").strip(),
        "categories": clean_list_field(raw_item.get("categories")),
        "favorite": False,
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
        if self.path.startswith("/api/fetch-title"):
            self._handle_fetch_title()
            return
        super().do_GET()

    def _handle_fetch_title(self):
        query = urllib.parse.urlsplit(self.path).query
        url = (urllib.parse.parse_qs(query).get("url") or [""])[0]
        if not url:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "parâmetro url é obrigatório"})
            return
        try:
            title = fetch_page_title(url)
        except (urllib.error.URLError, ValueError, OSError) as exc:
            self._send_json(HTTPStatus.OK, {"title": None, "error": str(exc)})
            return
        self._send_json(HTTPStatus.OK, {"title": title})

    def do_POST(self):
        if self.path == "/api/bookmarks":
            self._handle_create()
        elif self.path == "/api/import":
            self._handle_import()
        elif self.path.startswith("/api/category-groups/") and self.path.endswith("/categories"):
            group_id, _ = self._extract_category_path()
            self._handle_add_category(group_id)
        elif self.path == "/api/actions":
            self._handle_add_action()
        else:
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})

    def do_PUT(self):
        if self.path.startswith("/api/category-groups/"):
            group_id, name = self._extract_category_path()
            if name is None:
                self._send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})
                return
            self._handle_rename_category(group_id, name)
            return
        if self.path.startswith("/api/actions/"):
            name = self._extract_action_name()
            if name is None:
                self._send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})
                return
            self._handle_rename_action(name)
            return
        if self.path.startswith("/api/tags/"):
            name = self._extract_tag_path()
            if name is None:
                self._send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})
                return
            self._handle_rename_tag(name)
            return
        bookmark_id = self._extract_bookmark_id()
        if bookmark_id is None:
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            return
        self._handle_update(bookmark_id)

    def do_DELETE(self):
        if self.path.startswith("/api/category-groups/"):
            group_id, name = self._extract_category_path()
            if name is None:
                self._send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})
                return
            self._handle_delete_category(group_id, name)
            return
        if self.path.startswith("/api/actions/"):
            name = self._extract_action_name()
            if name is None:
                self._send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})
                return
            self._handle_delete_action(name)
            return
        if self.path.startswith("/api/tags/"):
            name = self._extract_tag_path()
            if name is None:
                self._send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})
                return
            self._handle_delete_tag(name)
            return
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

    def _extract_category_path(self):
        prefix = "/api/category-groups/"
        remainder = self.path[len(prefix):]
        marker = "/categories"
        idx = remainder.find(marker)
        if idx == -1:
            return None, None
        group_id = urllib.parse.unquote(remainder[:idx]) or None
        rest = remainder[idx + len(marker):]
        name = urllib.parse.unquote(rest[1:]) if rest.startswith("/") and len(rest) > 1 else None
        return group_id, name

    def _extract_action_name(self):
        prefix = "/api/actions/"
        if not self.path.startswith(prefix):
            return None
        name = self.path[len(prefix):]
        return urllib.parse.unquote(name) if name else None

    def _extract_tag_path(self):
        prefix = "/api/tags/"
        if not self.path.startswith(prefix):
            return None
        name = self.path[len(prefix):]
        return urllib.parse.unquote(name) or None

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
        merge_known_categories(data, clean_list_field(payload.get("newCategories")), payload.get("newCategoryGroup"))
        merge_known_actions(data, new_bookmark["action"])
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
            merge_known_actions(data, bookmark["action"])

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
        action = (payload.get("action") or "").strip()
        target["url"] = url
        target["title"] = title
        target["description"] = (payload.get("description") or "").strip()
        target["tags"] = clean_list_field(payload.get("tags"))
        target["action"] = action
        target["categories"] = categories
        target["favorite"] = bool(payload.get("favorite"))
        target["favoriteNote"] = (payload.get("favoriteNote") or "").strip()
        merge_known_categories(data, clean_list_field(payload.get("newCategories")), payload.get("newCategoryGroup"))
        merge_known_actions(data, action)
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

    def _handle_add_category(self, group_id):
        try:
            payload = self._read_json_body()
        except json.JSONDecodeError:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "JSON inválido"})
            return

        try:
            data = read_bookmarks()
        except (OSError, json.JSONDecodeError) as exc:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)})
            return

        try:
            add_category(data, group_id, payload.get("name"))
        except ValueError as exc:
            self._send_json(HTTPStatus.CONFLICT, {"error": str(exc)})
            return

        write_bookmarks(data)
        self._send_json(HTTPStatus.OK, data)

    def _handle_rename_category(self, group_id, old_name):
        try:
            payload = self._read_json_body()
        except json.JSONDecodeError:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "JSON inválido"})
            return

        try:
            data = read_bookmarks()
        except (OSError, json.JSONDecodeError) as exc:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)})
            return

        try:
            rename_category(data, group_id, old_name, payload.get("name"))
        except ValueError as exc:
            self._send_json(HTTPStatus.CONFLICT, {"error": str(exc)})
            return

        write_bookmarks(data)
        self._send_json(HTTPStatus.OK, data)

    def _handle_delete_category(self, group_id, name):
        try:
            data = read_bookmarks()
        except (OSError, json.JSONDecodeError) as exc:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)})
            return

        try:
            delete_category(data, group_id, name)
        except ValueError as exc:
            self._send_json(HTTPStatus.CONFLICT, {"error": str(exc)})
            return

        write_bookmarks(data)
        self._send_json(HTTPStatus.OK, data)

    def _handle_add_action(self):
        try:
            payload = self._read_json_body()
        except json.JSONDecodeError:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "JSON inválido"})
            return

        try:
            data = read_bookmarks()
        except (OSError, json.JSONDecodeError) as exc:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)})
            return

        try:
            add_action(data, payload.get("name"))
        except ValueError as exc:
            self._send_json(HTTPStatus.CONFLICT, {"error": str(exc)})
            return

        write_bookmarks(data)
        self._send_json(HTTPStatus.OK, data)

    def _handle_rename_action(self, old_name):
        try:
            payload = self._read_json_body()
        except json.JSONDecodeError:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "JSON inválido"})
            return

        try:
            data = read_bookmarks()
        except (OSError, json.JSONDecodeError) as exc:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)})
            return

        try:
            rename_action(data, old_name, payload.get("name"))
        except ValueError as exc:
            self._send_json(HTTPStatus.CONFLICT, {"error": str(exc)})
            return

        write_bookmarks(data)
        self._send_json(HTTPStatus.OK, data)

    def _handle_delete_action(self, name):
        try:
            data = read_bookmarks()
        except (OSError, json.JSONDecodeError) as exc:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)})
            return

        try:
            delete_action(data, name)
        except ValueError as exc:
            self._send_json(HTTPStatus.CONFLICT, {"error": str(exc)})
            return

        write_bookmarks(data)
        self._send_json(HTTPStatus.OK, data)

    def _handle_rename_tag(self, old_name):
        try:
            payload = self._read_json_body()
        except json.JSONDecodeError:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "JSON inválido"})
            return

        try:
            data = read_bookmarks()
        except (OSError, json.JSONDecodeError) as exc:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)})
            return

        try:
            rename_tag(data, old_name, payload.get("name"))
        except ValueError as exc:
            self._send_json(HTTPStatus.CONFLICT, {"error": str(exc)})
            return

        write_bookmarks(data)
        self._send_json(HTTPStatus.OK, data)

    def _handle_delete_tag(self, name):
        try:
            data = read_bookmarks()
        except (OSError, json.JSONDecodeError) as exc:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)})
            return

        try:
            delete_tag(data, name)
        except ValueError as exc:
            self._send_json(HTTPStatus.CONFLICT, {"error": str(exc)})
            return

        write_bookmarks(data)
        self._send_json(HTTPStatus.OK, data)


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
