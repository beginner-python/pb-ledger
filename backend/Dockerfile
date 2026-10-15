# https://docs.docker.jp/compose/django.html
FROM python:3.12-slim

# Pythonの標準出力/標準エラーを即時表示し、pyc生成を抑止
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

# 作業ディレクトリを作成
WORKDIR /app

# 依存解決用のファイルだけ先にコピー（キャッシュ効率UP）
COPY pyproject.toml uv.lock ./

# pip/uv を用意して依存をインストール
RUN pip install --upgrade pip
RUN pip install --no-cache-dir uv

ENV VIRTUAL_ENV=/app/.venv \
    PATH="/app/.venv/bin:$PATH"

# アプリ本体をコピー
COPY . .

# 起動時に .venv (named volume) へ依存を同期してからアプリ起動
CMD ["sh", "-c", "uv sync --frozen --extra dev --no-install-project && uvicorn pb_ledger.asgi:application --host 0.0.0.0 --port 8000 --reload"]
