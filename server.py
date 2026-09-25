#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
server.py — DBVERSE
=====================
3D ER図 → クリック → データ表。ASK（自然言語→SQL自動実行・SSEストリーミング）付き。

    python server.py
    python server.py sqlite
    python server.py sqlite mydb.sqlite
    python server.py postgres
    python server.py postgres host=h dbname=d user=u password=p

    → http://localhost:8888

PostgreSQL を使う場合は:
    pip install psycopg2-binary httpx
"""

import http.server
import json
import os
import random
import re
import sys
import threading
import time
from datetime import datetime, timedelta
from urllib.parse import urlparse, parse_qs

try:
    from config import DB as CONFIG_DB, LLM, SERVER, UI, CHRONOS
except ImportError:
    print("[error] config.py が見つかりません。")
    print("  cp config.sample.py config.py  して編集してください。")
    sys.exit(1)

# 既存コードとの互換のため CONFIG に格納
CONFIG = CONFIG_DB

LLM_SYSTEM_POSTGRES = """あなたはPostgreSQLのアシスタント。
質問に答える。SQLで答えられるなら SELECT 文を1つだけ出力する。
余計な前置きや説明は書かない。SQLのみを出力し、絶対に 'sql:' などのプレフィックスを付けない。

ルール:
- SELECT または WITH で始まる文のみ出力する
- psql のメタコマンド（\\d 等）や SHOW は使わない
- 識別子・予約語はダブルクォートで囲む
- LIMIT を必ず付ける
- テーブル一覧は information_schema.tables を使う
- テーブル定義は information_schema.columns を使う

例:
q: usersテーブルの件数
SELECT COUNT(*) FROM "users";

q: usersテーブルの列定義
SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='users' ORDER BY ordinal_position;

q: テーブル一覧
SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name;
"""

LLM_SYSTEM_SQLITE = """あなたはSQLiteのアシスタント。
質問に答える。SQLで答えるなら SELECT 文を1つだけ出力する。
余計な前置きや説明は書かない。SQLのみを出力し、絶対に 'sql:' などのプレフィックスを付けない。

ルール:
- SELECT または WITH で始まる文のみ出力する
- PRAGMA は使わない。SELECT * FROM pragma_xxx(...) を使う
- 識別子・予約語はダブルクォートで囲む
- LIMIT を必ず付ける
- テーブル一覧は sqlite_master を使う

注意: 以下の列名は予約語なので必ずダブルクォートで囲む
  "notnull", "table", "from", "to", "unique", "index", "key", "order", "group", "values"

例:
q: usersテーブルの件数
SELECT COUNT(*) FROM "users";

q: usersテーブルの列定義
SELECT "cid", "name", "type", "notnull", "dflt_value", "pk" FROM pragma_table_info("users");

q: テーブル一覧
SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;
"""

def get_llm_system():
    """DB方言に応じたシステムプロンプトを返す"""
    if DB.dialect == "postgres":
        return LLM_SYSTEM_POSTGRES
    return LLM_SYSTEM_SQLITE


HOST = SERVER["host"]
PORT = SERVER["port"]
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")

LAYOUT_FILE = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "data", "layout2d.json")


def _log(msg):
    ts = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    print(f"[{ts}] {msg}", flush=True)


# ═══════════════════════════════════════════════════════════════
#  SQLite Adapter
# ═══════════════════════════════════════════════════════════════
class SQLiteAdapter:
    dialect = "sqlite"

    def __init__(self, path):
        import sqlite3
        self.sqlite3 = sqlite3
        if path in (":memory:", "", None):
            self.conn = sqlite3.connect(":memory:", check_same_thread=False)
            self.db_label = "<sample>"
            self._seed_sample()
        else:
            if not os.path.exists(path):
                raise SystemExit(f"[error] file not found: {path}")
            self.conn = sqlite3.connect(path, check_same_thread=False)
            self.db_label = os.path.basename(path)
        self.conn.row_factory = sqlite3.Row
        self.lock = threading.Lock()

    def q(self, name):
        return '"' + str(name).replace('"', '""') + '"'

    def ph(self):
        return "?"

    def row_id_alias(self):
        return "rowid"

    def row_id_expr(self, table):
        return "rowid"

    def row_id_where(self, table):
        return "rowid = ?"

    def list_tables(self):
        cur = self.conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' "
            "AND name NOT LIKE 'sqlite_%' ORDER BY name")
        return [r[0] for r in cur.fetchall()]

    def table_schema(self, name):
        cols = []
        for r in self.conn.execute(f"PRAGMA table_info({self.q(name)})"):
            cols.append({
                "name": r[1],
                "type": (r[2] or "ANY").upper(),
                "notnull": bool(r[3]),
                "pk": bool(r[5]),
            })
        fks = []
        for r in self.conn.execute(f"PRAGMA foreign_key_list({self.q(name)})"):
            fks.append({"from_col": r[3], "to_table": r[2], "to_col": r[4]})
        return {"columns": cols, "fks": fks}

    def count(self, name):
        return self.conn.execute(
            f"SELECT COUNT(*) FROM {self.q(name)}").fetchone()[0]

    def get_rows(self, table, limit, offset, sort, dir, filter_text):
        cols = [c["name"] for c in self.table_schema(table)["columns"]]
        params = []
        wc = ""
        if filter_text:
            ors = " OR ".join(
                [f"CAST({self.q(c)} AS TEXT) LIKE ?" for c in cols])
            wc = f"WHERE {ors}"
            params = [f"%{filter_text}%"] * len(cols)
        oc = ""
        if sort == "rowid":
            oc = f"ORDER BY rowid {dir}"
        elif sort and sort in cols:
            oc = f"ORDER BY {self.q(sort)} {dir}"
        total = self.conn.execute(
            f"SELECT COUNT(*) FROM {self.q(table)} {wc}", params).fetchone()[0]
        cur = self.conn.execute(
            f"SELECT rowid AS rowid, * FROM {self.q(table)} "
            f"{wc} {oc} LIMIT ? OFFSET ?", params + [limit, offset])
        rows = [list(r) for r in cur.fetchall()]
        return {"columns": ["rowid"] + cols, "rows": rows, "total": total}

    def update_cell(self, table, rid, col, val):
        self.conn.execute(
            f"UPDATE {self.q(table)} SET {self.q(col)} = ? WHERE rowid = ?",
            (val, int(rid)))
        self.conn.commit()
        return {"ok": True, "new_rid": rid}

    def delete_row(self, table, rid):
        self.conn.execute(
            f"DELETE FROM {self.q(table)} WHERE rowid = ?", (int(rid),))
        self.conn.commit()

    def delete_many(self, table, rids):
        for rid in rids:
            self.conn.execute(
                f"DELETE FROM {self.q(table)} WHERE rowid = ?", (int(rid),))
        self.conn.commit()
        return len(rids)

    def insert_default(self, table):
        self.conn.execute(f"INSERT INTO {self.q(table)} DEFAULT VALUES")
        self.conn.commit()
        rid = self.conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        return rid

    def _seed_sample(self):
        from sample_data import seed
        seed(self.conn)


# ═══════════════════════════════════════════════════════════════
#  PostgreSQL Adapter
# ═══════════════════════════════════════════════════════════════
class PostgresAdapter:
    dialect = "postgres"

    def __init__(self, cfg):
        try:
            import psycopg2
            import psycopg2.extras
        except ImportError:
            raise SystemExit(
                "[error] psycopg2 が必要です:  pip install psycopg2-binary")
        self.psycopg2 = psycopg2
        self.schema = cfg.get("schema", "public")
        self.conn = psycopg2.connect(
            host=cfg["host"], port=cfg["port"],
            dbname=cfg["dbname"], user=cfg["user"],
            password=cfg["password"])
        self.conn.autocommit = True
        self.lock = threading.Lock()
        self.db_label = f'{cfg["dbname"]}@{cfg["host"]}:{cfg["port"]}'
        self._pk_cache = {}

    def q(self, name):
        return '"' + str(name).replace('"', '""') + '"'

    def ph(self):
        return "%s"

    def row_id_alias(self):
        return "rowid"

    def row_id_expr(self, table):
        pk = self._pk_cols(table)
        if len(pk) == 1:
            return f"{self.q(pk[0])}"
        return "ctid::text"

    def row_id_where(self, table):
        pk = self._pk_cols(table)
        if len(pk) == 1:
            return f"{self.q(pk[0])} = %s"
        return "ctid = %s::tid"

    def _pk_cols(self, table):
        if table in self._pk_cache:
            return self._pk_cache[table]
        cur = self.conn.cursor()
        cur.execute("""
            SELECT a.attname
            FROM pg_index i
            JOIN pg_class c      ON c.oid = i.indrelid
            JOIN pg_namespace n  ON n.oid = c.relnamespace
            JOIN pg_attribute a  ON a.attrelid = i.indrelid
                                AND a.attnum = ANY(i.indkey)
            WHERE n.nspname = %s AND c.relname = %s AND i.indisprimary
        """, (self.schema, table))
        pks = [r[0] for r in cur.fetchall()]
        self._pk_cache[table] = pks
        return pks

    def list_tables(self):
        cur = self.conn.cursor()
        cur.execute("""
            SELECT tablename FROM pg_tables
            WHERE schemaname = %s ORDER BY tablename
        """, (self.schema,))
        return [r[0] for r in cur.fetchall()]

    # ─── 一括取得（pg_catalog 直叩き・3クエリ固定） ───
    def bulk_schema(self):
        cur = self.conn.cursor()

        # 1) テーブル一覧
        cur.execute("""
            SELECT c.relname
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = %s AND c.relkind IN ('r','p')
            ORDER BY c.relname
        """, (self.schema,))
        tables = {}
        for (name,) in cur.fetchall():
            tables[name] = {"columns": [], "fks": []}

        if not tables:
            return tables

        # 2) 全カラム + PK 判定
        cur.execute("""
            SELECT c.relname AS tbl,
                   a.attname AS col,
                   format_type(a.atttypid, a.atttypmod) AS typ,
                   a.attnotnull AS notnull,
                   a.attnum AS ord,
                   COALESCE(pk.is_pk, false) AS is_pk
            FROM pg_class c
            JOIN pg_namespace n  ON n.oid = c.relnamespace
            JOIN pg_attribute a  ON a.attrelid = c.oid
            LEFT JOIN (
                SELECT i.indrelid, unnest(i.indkey) AS attnum, true AS is_pk
                FROM pg_index i WHERE i.indisprimary
            ) pk ON pk.indrelid = c.oid AND pk.attnum = a.attnum
            WHERE n.nspname = %s
              AND c.relkind IN ('r','p')
              AND a.attnum > 0
              AND NOT a.attisdropped
            ORDER BY c.relname, a.attnum
        """, (self.schema,))
        for tbl, col, typ, notnull, ord_, is_pk in cur.fetchall():
            if tbl not in tables:
                continue
            tables[tbl]["columns"].append({
                "name": col,
                "type": typ,
                "notnull": bool(notnull),
                "pk": bool(is_pk),
            })

        # 3) 全FK
        cur.execute("""
            SELECT con.conrelid::regclass::text AS from_tbl,
                   a.attname  AS from_col,
                   con.confrelid::regclass::text AS to_tbl,
                   af.attname AS to_col
            FROM pg_constraint con
            JOIN pg_namespace n  ON n.oid = con.connamespace
            JOIN pg_attribute a  ON a.attrelid = con.conrelid
                                AND a.attnum = ANY(con.conkey)
            JOIN pg_attribute af ON af.attrelid = con.confrelid
                                AND af.attnum = ANY(con.confkey)
            WHERE con.contype = 'f'
              AND n.nspname = %s
        """, (self.schema,))
        for from_tbl, from_col, to_tbl, to_col in cur.fetchall():
            ft = from_tbl.split(".")[-1].strip('"')
            tt = to_tbl.split(".")[-1].strip('"')
            if ft in tables:
                tables[ft]["fks"].append({
                    "from_col": from_col,
                    "to_table": tt,
                    "to_col": to_col,
                })

        return tables

    # ─── 単一テーブル（AI用・既存互換） ───
    def table_schema(self, name):
        cur = self.conn.cursor()
        cur.execute("""
            SELECT column_name, data_type, is_nullable,
                   character_maximum_length, numeric_precision, numeric_scale
            FROM information_schema.columns
            WHERE table_schema = %s AND table_name = %s
            ORDER BY ordinal_position
        """, (self.schema, name))
        raw = cur.fetchall()
        pks = set(self._pk_cols(name))
        cols = []
        for r in raw:
            dt = r[1] or "any"
            cmax = r[3]
            nprec = r[4]
            nscale = r[5]
            if cmax is not None:
                dt = dt + "(" + str(cmax) + ")"
            elif nprec is not None:
                if nscale is not None and nscale > 0:
                    dt = dt + "(" + str(nprec) + "," + str(nscale) + ")"
                else:
                    dt = dt + "(" + str(nprec) + ")"
            cols.append({
                "name": r[0],
                "type": dt,
                "notnull": r[2] == "NO",
                "pk": r[0] in pks,
            })
        cur.execute("""
            SELECT kcu.column_name,
                   ccu.table_name AS foreign_table,
                   ccu.column_name AS foreign_column
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
             AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage ccu
              ON ccu.constraint_name = tc.constraint_name
             AND ccu.table_schema = tc.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY'
              AND tc.table_schema = %s AND tc.table_name = %s
        """, (self.schema, name))
        fks = [{"from_col": r[0], "to_table": r[1], "to_col": r[2]}
               for r in cur.fetchall()]
        return {"columns": cols, "fks": fks}

    def count(self, name):
        cur = self.conn.cursor()
        cur.execute(f"SELECT COUNT(*) FROM {self.q(name)}")
        return cur.fetchone()[0]

    def get_rows(self, table, limit, offset, sort, dir, filter_text):
        sch = self.table_schema(table)
        cols = [c["name"] for c in sch["columns"]]
        params = []
        wc = ""
        if filter_text:
            ors = " OR ".join(
                [f"CAST({self.q(c)} AS TEXT) LIKE %s" for c in cols])
            wc = f"WHERE {ors}"
            params = [f"%{filter_text}%"] * len(cols)
        oc = ""
        if sort == "rowid":
            pk = self._pk_cols(table)
            if len(pk) == 1:
                oc = f"ORDER BY {self.q(pk[0])} {dir}"
            else:
                oc = f"ORDER BY ctid {dir}"
        elif sort and sort in cols:
            oc = f"ORDER BY {self.q(sort)} {dir}"

        cur = self.conn.cursor()
        cur.execute(f"SELECT COUNT(*) FROM {self.q(table)} {wc}", params)
        total = cur.fetchone()[0]

        rid_expr = self.row_id_expr(table)
        cur.execute(
            f"SELECT {rid_expr} AS rowid, * FROM {self.q(table)} "
            f"{wc} {oc} LIMIT %s OFFSET %s",
            params + [limit, offset])
        rows = [list(r) for r in cur.fetchall()]
        return {"columns": ["rowid"] + cols, "rows": rows, "total": total}

    def update_cell(self, table, rid, col, val):
        cur = self.conn.cursor()
        where = self.row_id_where(table)
        cur.execute(
            f"UPDATE {self.q(table)} SET {self.q(col)} = %s WHERE {where} "
            f"RETURNING {self.row_id_expr(table)} AS new_rid",
            (val, rid))
        row = cur.fetchone()
        new_rid = row[0] if row else rid
        return {"ok": True, "new_rid": new_rid}

    def delete_row(self, table, rid):
        cur = self.conn.cursor()
        cur.execute(
            f"DELETE FROM {self.q(table)} WHERE {self.row_id_where(table)}",
            (rid,))

    def delete_many(self, table, rids):
        cur = self.conn.cursor()
        for rid in rids:
            cur.execute(
                f"DELETE FROM {self.q(table)} WHERE {self.row_id_where(table)}",
                (rid,))
        return len(rids)

    def insert_default(self, table):
        cur = self.conn.cursor()
        cur.execute(
            f"INSERT INTO {self.q(table)} DEFAULT VALUES "
            f"RETURNING {self.row_id_expr(table)} AS rid")
        rid = cur.fetchone()[0]
        return rid


DB = None


def build_adapter():
    global DB
    t = CONFIG["type"]
    if t == "sqlite":
        DB = SQLiteAdapter(CONFIG["sqlite"]["path"])
    elif t == "postgres":
        DB = PostgresAdapter(CONFIG["postgres"])
    else:
        raise SystemExit(f"[error] unknown db type: {t}")


def get_schema_compact():
    with DB.lock:
        if DB.dialect == "postgres":
            cur = DB.conn.cursor()
            cur.execute("SELECT tablename FROM pg_tables "
                        "WHERE schemaname = %s ORDER BY tablename",
                        (DB.schema,))
            names = [r[0] for r in cur.fetchall()]
        else:
            names = DB.list_tables()
        lines = []
        for name in names:
            sch = DB.table_schema(name)
            parts = []
            for c in sch["columns"]:
                piece = c["name"]
                if c.get("pk"):
                    piece += " PK"
                fk = next((f for f in sch["fks"]
                           if f["from_col"] == c["name"]), None)
                if fk:
                    piece += " FK->" + fk["to_table"] + "." + fk["to_col"]
                parts.append(piece)
            lines.append(name + "(" + ", ".join(parts) + ")")
        return "\n".join(lines)


_FENCE_RE = re.compile(r"```(?:sql)?\s*(.*?)```", re.DOTALL | re.IGNORECASE)
_SELECT_RE = re.compile(r"^\s*(SELECT|WITH)\b", re.IGNORECASE)
_FORBIDDEN_RE = re.compile(
    r"\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|COPY|VACUUM)\b",
    re.IGNORECASE)


def extract_sql(text):
    m = _FENCE_RE.search(text)
    if m:
        return m.group(1).strip()

    match = re.search(r"\b(SELECT|WITH)\b", text, re.IGNORECASE)
    if match:
        sql = text[match.start():].strip()
        sql = sql.split(";")[0].strip()
        return sql

    return text.strip()


def validate_sql(sql):
    sql = sql.strip().rstrip(";").strip()
    if not sql:
        raise ValueError("SQLが空です")
    if not _SELECT_RE.match(sql):
        raise ValueError("SELECT/WITH のみ許可されています")
    if ";" in sql:
        raise ValueError("複文は許可されていません")
    if _FORBIDDEN_RE.search(sql):
        raise ValueError("禁止されたキーワード")
    if not re.search(r"\bLIMIT\b", sql, re.IGNORECASE):
        sql = sql + " LIMIT 200"
    return sql


def run_sql_query(sql):
    t0 = time.perf_counter()
    with DB.lock:
        try:
            cur = DB.conn.cursor() if DB.dialect == "postgres" \
                else DB.conn.execute(sql)
            if DB.dialect == "postgres":
                cur.execute(sql)
                if cur.description:
                    cols = [x[0] for x in cur.description]
                    rows = [list(r) for r in cur.fetchall()]
                    aff = None
                else:
                    cols, rows, aff = [], [], cur.rowcount
            else:
                if cur.description:
                    cols = [x[0] for x in cur.description]
                    rows = [list(r) for r in cur.fetchall()]
                    aff = None
                else:
                    cols, rows, aff = [], [], cur.rowcount
                DB.conn.commit()
            ms = round((time.perf_counter() - t0) * 1000, 2)
            return {"columns": cols, "rows": rows, "affected": aff,
                    "elapsed_ms": ms, "error": None}
        except Exception as e:
            ms = round((time.perf_counter() - t0) * 1000, 2)
            return {"columns": [], "rows": [], "affected": None,
                    "elapsed_ms": ms, "error": str(e)}


def _get_llm_headers():
    headers = {"Content-Type": "application/json"}
    if LLM.get("api_key"):
        headers["Authorization"] = f"Bearer {LLM['api_key']}"
    return headers


# ═══════════════════════════════════════════════════════════════
#  HTTP Handler
# ═══════════════════════════════════════════════════════════════
class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def _log(self, msg):
        _log(msg)

    # -------- JSON
    def _json(self, obj, code=200):
        b = json.dumps(obj, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(b)
        except Exception:
            pass

    def _bytes(self, data, ctype, code=200):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        try:
            self.wfile.write(data)
        except Exception:
            pass

    def _body(self):
        n = int(self.headers.get("Content-Length", 0) or 0)
        if not n:
            return {}
        try:
            return json.loads(self.rfile.read(n).decode() or "{}")
        except Exception:
            return {}

    def _serve_static(self, rel):
        full = os.path.normpath(os.path.join(STATIC_DIR, rel))
        if not full.startswith(os.path.normpath(STATIC_DIR)):
            self._bytes(b"forbidden", "text/plain", 403)
            return
        if not os.path.isfile(full):
            self._bytes(b"not found", "text/plain", 404)
            return
        ext = os.path.splitext(full)[1].lower()
        ctype = {
            ".html": "text/html; charset=utf-8",
            ".css":  "text/css; charset=utf-8",
            ".js":   "application/javascript; charset=utf-8",
            ".json": "application/json; charset=utf-8",
            ".svg":  "image/svg+xml",
            ".png":  "image/png",
            ".ico":  "image/x-icon",
        }.get(ext, "application/octet-stream")
        with open(full, "rb") as f:
            self._bytes(f.read(), ctype)

    # -------- SSE
    def _sse_start(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache, no-transform")
        self.send_header("X-Accel-Buffering", "no")
        self.send_header("Transfer-Encoding", "chunked")
        self.end_headers()
        try:
            self.wfile.flush()
        except Exception:
            pass

    def _sse_write(self, data):
        try:
            raw = data.encode("utf-8")
            self.wfile.write(f"{len(raw):x}\r\n".encode("ascii"))
            self.wfile.write(raw)
            self.wfile.write(b"\r\n")
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass

    def _sse_event(self, event, obj):
        payload = json.dumps(obj, ensure_ascii=False, default=str)
        self._sse_write("event: " + event + "\ndata: " + payload + "\n\n")

    def _sse_end(self):
        try:
            self.wfile.write(b"0\r\n\r\n")
            self.wfile.flush()
        except Exception:
            pass

    # -------- GET
    def do_GET(self):
        t0 = time.perf_counter()
        parsed = urlparse(self.path)
        p = parsed.path
        try:
            if p in ("/", "/index.html"):
                self._serve_static("index.html")
            elif p in ("/m", "/m.html"):
                self._serve_static("m.html")
            elif p.startswith("/static/"):
                self._serve_static(p[len("/static/"):])
            elif p == "/api/schema":
                self._api_schema()
            elif p == "/api/counts":
                self._api_counts()
            elif p == "/api/config":
                self._json({**UI, "chronos": CHRONOS})
            elif p == "/api/ask_sse":
                params = parse_qs(parsed.query)
                q = (params.get("q") or [""])[0]
                self._api_ask_sse(q)
            elif p == "/api/layout2d":
                self._api_layout2d_get()
            else:
                self._json({"error": "not found"}, 404)
        finally:
            ms = (time.perf_counter() - t0) * 1000
            if not p.startswith("/static/") and p not in ("/", "/m", "/m.html"):
                self._log(f"GET  {p}  {ms:8.1f}ms")

    def _api_schema(self):
        t0 = time.perf_counter()
        with DB.lock:
            try:
                if DB.dialect == "postgres":
                    # PostgreSQL は pg_catalog 直叩きで一括取得
                    bulk = DB.bulk_schema()
                    tables = [
                        {
                            "name": name,
                            "columns": bulk[name]["columns"],
                            "fks": bulk[name]["fks"],
                            "rows": None,
                        }
                        for name in sorted(bulk.keys())
                    ]
                else:
                    # SQLite は従来通り
                    tables = []
                    for name in DB.list_tables():
                        sch = DB.table_schema(name)
                        tables.append({
                            "name": name,
                            "columns": sch["columns"],
                            "fks": sch["fks"],
                            "rows": None,
                        })
                ms = (time.perf_counter() - t0) * 1000
                self._log(
                    f"       schema built: {ms:.1f}ms  ({len(tables)} tables)")
                self._json({"name": DB.db_label, "tables": tables})
            except Exception as e:
                self._json({"error": str(e)}, 500)

    def _api_counts(self):
        t0 = time.perf_counter()
        with DB.lock:
            try:
                counts = {}
                for name in DB.list_tables():
                    tt = time.perf_counter()
                    counts[name] = DB.count(name)
                    tms = (time.perf_counter() - tt) * 1000
                    if tms > 100:
                        self._log(
                            f"       slow count: {name}  {tms:8.1f}ms")
                total_ms = (time.perf_counter() - t0) * 1000
                self._log(
                    f"       counts total: {total_ms:.1f}ms  ({len(counts)} tables)")
                self._json({"counts": counts})
            except Exception as e:
                self._json({"error": str(e)}, 500)

    def _api_layout2d_get(self):
        try:
            if os.path.exists(LAYOUT_FILE):
                with open(LAYOUT_FILE, "r", encoding="utf-8") as f:
                    self._json(json.load(f))
            else:
                self._json({})
        except Exception as e:
            self._json({"error": str(e)}, 500)

    def _api_layout2d_post(self, d):
        try:
            os.makedirs(os.path.dirname(LAYOUT_FILE), exist_ok=True)
            with open(LAYOUT_FILE, "w", encoding="utf-8") as f:
                json.dump(d, f, ensure_ascii=False, indent=2)
            self._json({"ok": True})
        except Exception as e:
            self._json({"error": str(e)}, 500)

    # -------- ASK (SSE)
    def _api_ask_sse(self, q):
        self._sse_start()

        if not LLM.get("url"):
            self._sse_event("done", {
                "error": "LLM未設定: config.py の LLM.url を設定してください"
            })
            self._sse_end()
            return

        try:
            import httpx
        except ImportError:
            self._sse_event("done", {"error": "httpx が必要です: pip install httpx"})
            self._sse_end()
            return

        if not q:
            self._sse_event("done", {"error": "empty question"})
            self._sse_end()
            return

        self._sse_event("open", {"ok": True})

        try:
            schema_str = get_schema_compact()
        except Exception as e:
            self._sse_event("done", {"error": "schema: " + str(e)})
            self._sse_end()
            return

        prompt = (get_llm_system() + "\n\nschema:\n" + schema_str +
                        "\n\nq: " + q + "\na: ")
        url = LLM["url"].rstrip("/") + LLM.get("path", "/v1/chat/completions")
        headers = _get_llm_headers()

        full_text = []
        t0 = time.perf_counter()

        try:
            with httpx.Client(timeout=LLM["timeout"]) as cli:
                with cli.stream("POST", url, headers=headers, json={
                    "model": LLM["model"],
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": LLM["n_predict"],
                    "temperature": 0.0,
                    **({"cache_prompt": True} if LLM.get("cache_prompt", True) else {}),
                    "stream": True,
                }) as resp:
                    resp.raise_for_status()

                    for line in resp.iter_lines():
                        if not line:
                            continue
                        if not line.startswith("data: "):
                            continue
                        payload = line[6:].strip()
                        if payload == "[DONE]":
                            break
                        try:
                            chunk = json.loads(payload)
                        except json.JSONDecodeError:
                            continue
                        choices = chunk.get("choices") or []
                        if not choices:
                            continue
                        delta = choices[0].get("delta") or {}
                        piece = delta.get("content") or ""
                        if piece:
                            full_text.append(piece)
                            self._sse_event("token", {"text": piece})
        except Exception as e:
            self._sse_event("done", {"error": "LLM error: " + str(e)})
            self._sse_end()
            return

        llm_ms = round((time.perf_counter() - t0) * 1000, 2)
        raw = "".join(full_text)

        try:
            sql = validate_sql(extract_sql(raw))
        except ValueError as e:
            self._sse_event("done", {"error": str(e), "raw": raw, "llm_ms": llm_ms})
            self._sse_end()
            return

        self._sse_event("sql", {"sql": sql})

        result = run_sql_query(sql)
        result["sql"] = sql
        result["raw"] = raw
        result["llm_ms"] = llm_ms
        self._sse_event("done", result)
        self._sse_end()

    # -------- POST
    def do_POST(self):
        t0 = time.perf_counter()
        p = urlparse(self.path).path
        d = self._body()
        try:
            if p == "/api/query":
                self._api_query(d)
            elif p == "/api/forecast":
                self._api_forecast(d)
            elif p == "/api/ask":
                self._api_ask(d)
            elif p == "/api/table":
                self._api_table(d)
            elif p == "/api/update":
                self._api_update(d)
            elif p == "/api/delete":
                self._api_delete(d)
            elif p == "/api/delete_many":
                self._api_delete_many(d)
            elif p == "/api/insert":
                self._api_insert(d)
            elif p == "/api/layout2d":
                self._api_layout2d_post(d)
            else:
                self._json({"error": "not found"}, 404)
        except Exception as e:
            self._json({"error": str(e)}, 500)
        finally:
            ms = (time.perf_counter() - t0) * 1000
            self._log(f"POST {p}  {ms:8.1f}ms")

    def do_DELETE(self):
        t0 = time.perf_counter()
        p = urlparse(self.path).path
        try:
            if p == "/api/layout2d":
                if os.path.exists(LAYOUT_FILE):
                    os.remove(LAYOUT_FILE)
                self._json({"ok": True})
            else:
                self._json({"error": "not found"}, 404)
        except Exception as e:
            self._json({"error": str(e)}, 500)
        finally:
            ms = (time.perf_counter() - t0) * 1000
            self._log(f"DEL  {p}  {ms:8.1f}ms")

    def _api_query(self, d):
        sql = (d.get("sql") or "").strip()
        if not sql:
            self._json({"error": "empty"})
            return
        r = run_sql_query(sql)
        r["sql"] = sql
        self._json(r)

    def _api_forecast(self, d):
        """chronos-service に転送（ブラウザからは見えない）"""
        if not CHRONOS.get("enabled", False):
            self._json({"error": "予測機能は無効です"}, 503)
            return
        if not CHRONOS.get("url"):
            self._json({"error": "CHRONOS.url が設定されていません"}, 500)
            return
        try:
            import httpx
        except ImportError:
            self._json({"error": "httpx が必要です"}, 500)
            return
        try:
            with httpx.Client(timeout=180.0) as cli:
                r = cli.post(f"{CHRONOS['url'].rstrip('/')}/predict", json=d)
                r.raise_for_status()
                self._json(r.json())
        except Exception as e:
            self._json({"error": f"予測サービスエラー: {e}"}, 502)
            
    def _api_ask(self, d):
        """非ストリーミング版（フォールバック用）"""
        q = (d.get("question") or "").strip()
        if not q:
            self._json({"error": "empty question"})
            return
        if not LLM.get("url"):
            self._json({"error": "LLM未設定: config.py の LLM.url を設定してください"})
            return
        try:
            import httpx
        except ImportError:
            self._json({"error": "httpx が必要です: pip install httpx"})
            return

        try:
            schema_str = get_schema_compact()
        except Exception as e:
            self._json({"error": "schema: " + str(e)})
            return

        prompt = (get_llm_system() + "\n\nschema:\n" + schema_str +
                  "\n\nq: " + q + "\na: ")
        url = LLM["url"].rstrip("/") + LLM.get("path", "/v1/chat/completions")
        headers = _get_llm_headers()

        payload = {
            "model": LLM["model"],
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": LLM["n_predict"],
            "temperature": 0.0,
            **({"cache_prompt": True} if LLM.get("cache_prompt", True) else {}),
        }

        t0 = time.perf_counter()
        try:
            with httpx.Client(timeout=LLM["timeout"]) as cli:
                r = cli.post(url, headers=headers, json=payload)
                r.raise_for_status()
                data = r.json()
        except Exception as e:
            self._json({"error": "LLM error: " + str(e)})
            return

        llm_ms = round((time.perf_counter() - t0) * 1000, 2)
        raw = (data.get("choices") or [{}])[0].get("message", {}).get("content", "")

        try:
            sql = validate_sql(extract_sql(raw))
        except ValueError as e:
            self._json({"error": str(e), "raw": raw, "llm_ms": llm_ms})
            return

        result = run_sql_query(sql)
        result["sql"] = sql
        result["raw"] = raw
        result["llm_ms"] = llm_ms
        self._json(result)

    def _api_table(self, d):
        name = d.get("name")
        limit = max(1, min(int(d.get("limit", 500)), 5000))
        offset = max(0, int(d.get("offset", 0)))
        sort_col = d.get("sort")
        sort_dir = "DESC" if str(d.get("dir", "")).lower() == "desc" else "ASC"
        ft = (d.get("filter") or "").strip()
        with DB.lock:
            r = DB.get_rows(name, limit, offset, sort_col, sort_dir, ft)
        r.update({"name": name, "offset": offset, "limit": limit, "error": None})
        self._json(r)

    def _api_update(self, d):
        with DB.lock:
            r = DB.update_cell(d["table"], d["rowid"], d["col"], d.get("val"))
        self._json(r)

    def _api_delete(self, d):
        with DB.lock:
            DB.delete_row(d["table"], d["rowid"])
        self._json({"ok": True})

    def _api_delete_many(self, d):
        with DB.lock:
            n = DB.delete_many(d["table"], d.get("rowids", []))
        self._json({"ok": True, "deleted": n})

    def _api_insert(self, d):
        with DB.lock:
            rid = DB.insert_default(d["table"])
        self._json({"ok": True, "rowid": rid})


class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def parse_args(argv):
    if len(argv) < 1:
        return
    t = argv[0].lower()
    if t in ("sqlite", "postgres"):
        CONFIG["type"] = t
    elif t in ("-h", "--help"):
        print(__doc__)
        sys.exit(0)
    else:
        CONFIG["type"] = "sqlite"
        CONFIG["sqlite"]["path"] = argv[0]
        return

    rest = argv[1:]
    if t == "sqlite":
        if rest:
            CONFIG["sqlite"]["path"] = rest[0]
    elif t == "postgres":
        for a in rest:
            if "=" in a:
                k, v = a.split("=", 1)
                if k == "port":
                    v = int(v)
                CONFIG["postgres"][k] = v


def main():
    parse_args(sys.argv[1:])
    build_adapter()

    srv = Server((HOST, PORT), Handler)
    print("═" * 60, flush=True)
    print("  DBVERSE", flush=True)
    print("  Type : %s" % CONFIG["type"], flush=True)
    print("  DB   : %s" % DB.db_label, flush=True)
    print("  LLM  : %s (%s)" % (LLM["url"], LLM["model"]), flush=True)
    print("  Open : http://localhost:%d" % PORT, flush=True)
    print("═" * 60, flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n[shutdown]", flush=True)
        srv.shutdown()


if __name__ == "__main__":
    main()