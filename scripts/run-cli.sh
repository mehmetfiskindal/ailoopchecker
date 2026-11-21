#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BIN="$ROOT_DIR/dist/ailoopchecker"

run_engine() {
  if [ -x "$BIN" ]; then
    exec "$BIN" "$@"
  else
    exec node "$ROOT_DIR/src/cli.ts" "$@"
  fi
}

DIRS=()
PASS_ARGS=()

for arg in "$@"; do
  if [ -d "$arg" ]; then
    DIRS+=("$arg")
  else
    PASS_ARGS+=("$arg")
  fi
done

if [ "${#DIRS[@]}" -eq 0 ]; then
  run_engine "$@"
fi

TMP_LIST="$(mktemp)"
trap 'rm -f "$TMP_LIST"' EXIT

collect_dir_files() {
  local dir="$1"
  local abs_dir
  abs_dir="$(cd "$dir" && pwd)"

  if command -v git >/dev/null 2>&1 && git -C "$abs_dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git -C "$abs_dir" ls-files -z --cached --others --exclude-standard | while IFS= read -r -d '' rel; do
      local full="$abs_dir/$rel"
      [ -f "$full" ] || continue
      printf '%s\n' "$full"
    done
  else
    find "$abs_dir" \
      \( -name '.git' -o -name 'node_modules' -o -name 'dist' -o -name 'build' -o -name 'target' -o -name '.venv' -o -name 'venv' -o -name '__pycache__' -o -name '.next' -o -name '.nuxt' -o -name '.turbo' -o -name '.expo' -o -name '.gradle' -o -name '.cache' -o -name 'coverage' -o -name '.idea' -o -name '.vscode' -o -name 'vendor' -o -name 'Pods' \) -prune \
      -o -type f -size -50M -print
  fi
}

for dir in "${DIRS[@]}"; do
  collect_dir_files "$dir"
done | grep -Ev '(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|\.lock$|\.tar\.zst$|\.tar\.gz$|\.zip$|\.map$|\.min\.(js|css)$|\.woff2?$|\.ttf$|\.eot$|\.ico$|\.pdf$)' | sort -u > "$TMP_LIST" || true

FILE_COUNT="$(wc -l < "$TMP_LIST")"
if [ "$FILE_COUNT" -eq 0 ]; then
  echo "Hata: Belirtilen dizinde taranacak dosya bulunamadı: ${DIRS[*]}" >&2
  exit 1
fi

PROJ_NAME="$(basename "$(cd "${DIRS[0]}" && pwd)")"
if [ "${#DIRS[@]}" -gt 1 ]; then
  PROJ_NAME="${PROJ_NAME}+${#DIRS[@]}dirs"
fi

run_engine --project --project-name "$PROJ_NAME" --file-list "$TMP_LIST" "${PASS_ARGS[@]}"
