#!/bin/bash
# MilSim Replay — launcher for macOS .app bundle
# Double-click the .app to start the server and open the browser.
# Data is stored in ~/MilSimReplay/ by default.

SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
BINARY="$SELF_DIR/../Resources/wargame-replay"
DATA_DIR="${HOME}/MilSimReplay"
mkdir -p "$DATA_DIR"

# Open browser once the server is ready (background, timeout 15s)
(
  for _ in $(seq 1 30); do
    if curl -sf http://127.0.0.1:8080/api/health > /dev/null 2>&1; then
      open "http://127.0.0.1:8080"
      break
    fi
    sleep 0.5
  done
) &

# Run server (foreground — keeps .app process alive; Force Quit stops it)
exec "$BINARY" -dir "$DATA_DIR"
