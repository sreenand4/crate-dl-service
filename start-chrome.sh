#!/bin/bash
set -a
source "$(dirname "$0")/.env"
set +a

exec xvfb-run -a "${CHROME_EXECUTABLE_PATH:-google-chrome}" \
  --user-data-dir="${CHROME_USER_DATA_DIR:-$HOME/chrome-profile}" \
  --remote-debugging-port="${CHROME_DEBUG_PORT:-9222}" \
  --remote-debugging-address=127.0.0.1 \
  --disable-dev-shm-usage \
  --disable-gpu \
  --no-first-run \
  --no-default-browser-check \
  --no-sandbox \
  --password-store=basic \
  about:blank
