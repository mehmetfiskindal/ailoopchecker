#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "Kullanım / Usage: $0 <proje_dizini> [ek ailoopchecker seçenekleri: --json -v --strict --lang en]" >&2
  exit 1
fi

PROJECT_DIR="$1"
shift

if [ ! -d "$PROJECT_DIR" ]; then
  echo "Hata: Dizin bulunamadı: $PROJECT_DIR" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BIN="$ROOT_DIR/dist/ailoopchecker"

TMP_LIST="$(mktemp)"
trap 'rm -f "$TMP_LIST"' EXIT

find "$PROJECT_DIR" \
  \( -name '.git' -o -name 'node_modules' -o -name 'dist' -o -name 'build' -o -name 'target' -o -name '.venv' -o -name 'venv' -o -name '__pycache__' -o -name '.next' -o -name '.cache' \) -prune \
  -o -type f -size -50M -print | sort > "$TMP_LIST"

FILE_COUNT="$(wc -l < "$TMP_LIST")"
if [ "$FILE_COUNT" -eq 0 ]; then
  echo "Taranacak dosya bulunamadı: $PROJECT_DIR" >&2
  exit 1
fi

if [ -x "$BIN" ]; then
  exec "$BIN" --project --file-list "$TMP_LIST" "$@"
else
  exec node "$ROOT_DIR/src/cli.ts" --project --file-list "$TMP_LIST" "$@"
fi
