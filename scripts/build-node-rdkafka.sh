#!/bin/bash

RDKAFKA_PATH=$(find node_modules/.pnpm/node-rdkafka@* -type d -name "node-rdkafka" -path "*/node_modules/node-rdkafka" | head -1)

if [ -z "$RDKAFKA_PATH" ]; then
  exit 0
fi

if [ -f "$RDKAFKA_PATH/build/Release/node-librdkafka.node" ]; then
  exit 0
fi

ORIGINAL_DIR=$(pwd)
cd "$RDKAFKA_PATH" || exit 0
npm run install 2>&1 | grep -v "gyp ERR" || true
cd "$ORIGINAL_DIR" || exit 0

if [ -f "$RDKAFKA_PATH/build/Release/node-librdkafka.node" ]; then
  exit 0
fi

exit 0