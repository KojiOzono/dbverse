#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DBVERSE 設定ファイル テンプレート
=================================
このファイルをコピーして config.py を作成し、値を編集してください。

    cp config.sample.py config.py

デフォルトでは SQLite のインメモリDB（サンプルデータ付き）を使うので、
そのまま起動すればすぐに試せます。
"""

# ═══════════════════════════════════════════════════════════
#  データベース接続
#
#  type:
#    "sqlite"   … サンプルデータ or 指定ファイルを使う
#    "postgres" … PostgreSQL に接続する
#
#  sqlite:
#    ":memory:"          … 起動のたびにサンプルデータが自動投入される
#    "path/to/db.sqlite" … 既存のSQLiteファイルを使う
#
#  postgres:
#    type が "postgres" のときだけ使われる。
#    schema は通常 "public" のままでOK。
# ═══════════════════════════════════════════════════════════
DB = {
    "type": "sqlite",

    "sqlite": {
        "path": ":memory:",
    },

    "postgres": {
        "host":     "your_host",
        "port":     5432,
        "dbname":   "your_db",
        "user":     "your_user",
        "password": "your_password",
        "schema":   "public",
    },
}


# ═══════════════════════════════════════════════════════════
#  LLM 接続
#
#  自然言語機能（Text-to-SQL）を使う場合に設定します。
#  SQLモード（手書き）だけ使う場合は、空のままで動作します。
#
#  url:
#    OpenAI互換APIのエンドポイント（例: "http://localhost:9999"）
#
#  model:
#    使用するモデル名
#
#  n_predict:
#    1回の応答で生成する最大トークン数
#
#  timeout:
#    LLM応答のタイムアウト秒数
#
#  api_key:
#    "Authorization: Bearer <api_key>" として送信される。
#    認証不要なサーバー（llama-server 等）なら空 "" でOK。
# ═══════════════════════════════════════════════════════════

# --- 使わない場合（デフォルト） ---
LLM = {
    "url":       "",
    "model":     "",
    "n_predict": 512,
    "timeout":   300.0,
    "api_key":   "",
}

# --- 使う場合は、上をコメントアウトして以下を使う ---
# LLM = {
#     "url":       "http://localhost:9999",
#     "model":     "your_model_name",
#     "n_predict": 512,
#     "timeout":   300.0,
#     "api_key":   "sk-your-key",
# }


# ═══════════════════════════════════════════════════════════
#  サーバー
#
#  host:
#    "127.0.0.1" … 自分のPCからのみアクセス可能（安全）
#    "0.0.0.0"   … LAN内の他PCからもアクセス可能（便利）
#
#  port:
#    ブラウザで開くときのポート番号
#    http://localhost:<port>/
#    他のサービスと被らなければ何でもOK（8888, 8000, 3000 等）
# ═══════════════════════════════════════════════════════════
SERVER = {
    "host": "0.0.0.0",
    "port": 8888,
}


# ═══════════════════════════════════════════════════════════
#  UI 設定（ブラウザに配信される）
#
#  テーブル名の短縮
#    "app_users" のような共通接頭辞を表示から除去し、
#    一覧やER図を見やすくする。（DB上の名前は変えない）
#
#  shorten_prefixes:
#    除去する接頭辞のリスト。例: ["app_"]
#    空配列 [] なら短縮しない。
#
#  shorten_table_names:
#    "auto"   … shorten_prefixes にマッチしたものを除去
#    "always" … 常に最初の "_" までを除去
#    "never"  … 短縮しない
# ═══════════════════════════════════════════════════════════
UI = {
    "shorten_prefixes": [],
    "shorten_table_names": "auto",
}