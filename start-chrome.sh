#!/bin/bash
set -a
source "$(dirname "$0")/.env"
set +a

exec xvfb-run -a "${CHROME_EXECUTABLE_PATH:-google-chrome}" \
  --user-data-dir="${CHROME_USER_DATA_DIR:-$HOME/chrome-profile}" \
  --disable-dev-shm-usage \
  --disable-gpu \
  --remote-debugging-port="${CHROME_DEBUG_PORT:-9222}" \
  --remote-debugging-address=127.0.0.1 \
  --no-first-run \
  --no-default-browser-check \
  --password-store=basic \
  about:blank
