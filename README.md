# DBVERSE

3D ER図 + Text-to-SQL のデータベースクライアント。

スキーマを3D空間に浮かぶカードとして可視化し、自然言語でSQLを生成・実行できるDBツールです。

## 主な機能

- **3D ER図** — テーブルを立体的に表示。リレーション線をリアルタイムで描画
- **2D ER図** — 平面レイアウト。カードをドラッグで移動でき、配置はサーバーに保存される
- **Text-to-SQL** — 自然言語で質問すると、LLMがSQLを生成して自動実行
- **ストリーミング表示** — 生成中のSQLをSSEでリアルタイム表示
- **データビュー** — テーブルの中身を表示・編集・エクスポート
- **CRUD操作** — 行の追加・編集・削除に対応
- **ドラッグ&ドロップ** — テーブル名・カラム名をSQLバーに挿入

## 必要なもの

- Python 3.10+
- （PostgreSQLを使う場合）PostgreSQL サーバー
- （Text-to-SQLを使う場合）OpenAI互換APIのLLM
  - ローカル: llama-server, Ollama, vLLM, LM Studio
  - クラウド: OpenAI, Gemini, Anthropic, Groq, OpenRouter 等

## セットアップ

    git clone https://github.com/KojiOzono/dbverse.git
    cd dbverse
    python3 -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt
    cp config.sample.py config.py
    python server.py

ブラウザで http://localhost:8888 を開く。

`config.py` でDB接続とLLMを設定できる。デフォルトはSQLite（サンプルデータ付き）で、そのまま起動すれば試せる。

## 使い方

- **ER図** — サイドバーでテーブルを選択。3D / 2D 切替可能
- **自然言語でSQL** — 「自然言語」タブで質問すると、LLMがSQLを生成して実行
- **データ編集** — セルをダブルクリックで編集、行を選択して削除

## 技術スタック

- **サーバー**: Python 標準ライブラリ (http.server)
- **DB接続**: psycopg2 (PostgreSQL) / sqlite3 (SQLite)
- **3D描画**: Three.js
- **LLM連携**: httpx (OpenAI互換API)
- **ストリーミング**: Server-Sent Events (SSE)

## ライセンス

MIT License
