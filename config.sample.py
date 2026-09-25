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
#  OpenAI互換APIなら何でも使えます：
#    ローカル : llama-server, Ollama, vLLM, LM Studio
#    クラウド : OpenAI, Gemini, Anthropic, Groq, OpenRouter 等
#
#  url:
#    OpenAI互換APIのエンドポイント
#
#  path:
#    APIのパス。省略時は "/v1/chat/completions"。
#    Gemini のみ "/chat/completions"。
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
#
#  cache_prompt:
#    プロンプトキャッシュを使うか。
#    llama-server は True（省略可）、クラウドは False。
# ═══════════════════════════════════════════════════════════

# --- 使わない場合（デフォルト） ---
LLM = {
    "url":       "",
    "model":     "",
    "n_predict": 512,
    "timeout":   300.0,
    "api_key":   "",
}

# --- ローカルLLM（llama-server 等） ---
# LLM = {
#     "url":       "http://localhost:9999",
#     "model":     "your_model_name",
#     "n_predict": 512,
#     "timeout":   300.0,
#     "api_key":   "",
# }

# --- OpenAI ---
# LLM = {
#     "url":       "https://api.openai.com",
#     "model":     "gpt-4o-mini",
#     "n_predict": 512,
#     "timeout":   300.0,
#     "api_key":   "sk-...",
#     "cache_prompt": False,
# }

# --- Gemini ---
# LLM = {
#     "url":       "https://generativelanguage.googleapis.com/v1beta/openai",
#     "path":      "/chat/completions",
#     "model":     "gemini-3.5-flash",
#     "n_predict": 512,
#     "timeout":   300.0,
#     "api_key":   "AIza...",
#     "cache_prompt": False,
# }

# --- Anthropic ---
# LLM = {
#     "url":       "https://api.anthropic.com",
#     "path":      "/v1/chat/completions",
#     "model":     "claude-sonnet-4",
#     "n_predict": 512,
#     "timeout":   300.0,
#     "api_key":   "sk-ant-...",
#     "cache_prompt": False,
# }

# --- Groq（無料枠あり、高速） ---
# LLM = {
#     "url":       "https://api.groq.com/openai",
#     "model":     "llama-3.3-70b-versatile",
#     "n_predict": 512,
#     "timeout":   300.0,
#     "api_key":   "gsk_...",
#     "cache_prompt": False,
# }

# --- OpenRouter（多数のモデルを1つのAPIで） ---
# LLM = {
#     "url":       "https://openrouter.ai/api",
#     "model":     "anthropic/claude-3.5-sonnet",
#     "n_predict": 512,
#     "timeout":   300.0,
#     "api_key":   "sk-or-...",
#     "cache_prompt": False,
# }


# ═══════════════════════════════════════════════════════════
#  Chronos 時系列予測サービス
#
#  グラフタブの「予測」機能を使う場合に設定します。
#  Chronos-2 を動かす推論サービス（chronos-service）への
#  接続先を指定します。
#
#  別プロジェクト（chronos-service）を先に起動しておくこと：
#    sudo systemctl start chronos-service
#    → ポート 8887 で待ち受ける
#
#  url:
#    chronos-service の場所。
#    同じマシンなら "http://localhost:8887"。
#    別マシンなら "http://vega:8887" のようにホスト名で指定。
#    ブラウザから直接アクセスするため、CORS が開いている必要がある。
#
#  enabled:
#    True  … グラフタブに「予測」チェックボックスを表示
#    False … 予測機能を隠す（chronos-service を使わない場合）
# ═══════════════════════════════════════════════════════════

# --- 使わない場合 ---
# CHRONOS = {
#     "url": "",
#     "enabled": False,
# }
CHRONOS = {
    "url": "http://localhost:8887",
    "enabled": True,
}

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
