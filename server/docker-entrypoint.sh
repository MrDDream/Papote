#!/bin/sh
# Starts as root only to make the data and backup folders writable (Docker creates missing
# bind-mount folders as root), then runs Papote as the unprivileged "node" user.
set -e
if [ "$(id -u)" = "0" ]; then
  for dir in "${DATA_DIR:-/data}" "${BACKUP_DIR:-}"; do
    [ -n "$dir" ] || continue
    mkdir -p "$dir"
    # Fix anything not owned by the server user (new folder, files written as root by hand…).
    find "$dir" ! -user node -exec chown node:node {} +
  done
  exec su-exec node "$@"
fi
exec "$@"
