#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "Kullanım / Usage: $0 <proje_dizini> [ek ailoopchecker seçenekleri: --json -v --strict --lang en]" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$SCRIPT_DIR/run-cli.sh" "$@"
