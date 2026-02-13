#!/usr/bin/env sh
set -eu

# Ensure data path exists and is writable
DATA_PATH=${DATA_PATH:-/data}

mkdir -p "$DATA_PATH"

# If mounted volume is owned by root, try to chown to node
if [ "$(stat -c %u "$DATA_PATH" 2>/dev/null || echo 0)" = "0" ]; then
  echo "Fixing ownership of $DATA_PATH to node:node"
  chown -R node:node "$DATA_PATH" || true
fi

# If file doesn't exist, ensure the node user can create it
if [ ! -e "$DATA_PATH/jellyprobe.db" ]; then
  su-exec node sh -c "touch '$DATA_PATH/jellyprobe.db' || true"
fi

# Drop root privileges and run the command as 'node'
exec su-exec node "$@"
