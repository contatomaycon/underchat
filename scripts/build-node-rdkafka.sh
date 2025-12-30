#!/bin/bash

set -e

RDKAFKA_PATH=$(find node_modules/.pnpm/node-rdkafka@* -type d -name "node-rdkafka" -path "*/node_modules/node-rdkafka" | head -1)

if [ -n "$RDKAFKA_PATH" ]; then
  if [ ! -f "$RDKAFKA_PATH/build/Release/node-librdkafka.node" ]; then
    echo "Compilando node-rdkafka em $RDKAFKA_PATH"
    cd "$RDKAFKA_PATH"
    npm run install
    cd - > /dev/null
    echo "node-rdkafka compilado com sucesso"
  else
    echo "node-rdkafka já está compilado"
  fi
else
  echo "node-rdkafka não encontrado em node_modules"
fi