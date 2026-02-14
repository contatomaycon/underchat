#!/bin/sh
set -eu

if [ -n "${WORKER_ID:-}" ]; then
  SESSION_DIR="/app/data/wwebjs/storage/${WORKER_ID}/.wwebjs_auth/session-${WORKER_ID}"

  for PROFILE_DIR in "$SESSION_DIR" "$SESSION_DIR/Default"; do
    if [ -d "$PROFILE_DIR" ]; then
      rm -rf \
        "$PROFILE_DIR/SingletonLock" \
        "$PROFILE_DIR/SingletonSocket" \
        "$PROFILE_DIR/SingletonCookie" \
        2>/dev/null || true
    fi
  done
fi

exec "$@"
