#!/bin/bash
SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
BINARY="$SELF_DIR/../Resources/wargame-replay"
DATA_DIR="${HOME}/MilSimReplay"
mkdir -p "$DATA_DIR"
exec "$BINARY" -dir "$DATA_DIR" -open
