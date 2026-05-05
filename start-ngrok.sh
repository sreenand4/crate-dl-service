#!/bin/bash
set -a
source "$(dirname "$0")/.env"
set +a

# ngrok reads NGROK_AUTHTOKEN from env; we alias our variable name to theirs
export NGROK_AUTHTOKEN="${NGROK_AUTH_TOKEN}"

exec ngrok http "${PORT:-4000}" --domain="${NGROK_DOMAIN}"
