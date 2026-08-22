#!/bin/sh

set -e

mkdir -p /.cache/node/corepack
chmod -R 777 /.cache 2>/dev/null || true

echo "Validando configuração discreta do PostgreSQL..."
if ! ENV=prod ./node_modules/.bin/tsx scripts/atlas-migrate.ts --check; then
  echo "Erro: configuração do Atlas/PostgreSQL inválida" >&2
  exit 1
fi

echo "Iniciando migrações..."

echo "Executando migrate:prod..."
ENV=prod pnpm run migrate:prod || {
  echo "Erro ao executar migrate:prod"
  exit 1
}

echo "Executando seed:zipcode:prod..."
ENV=zipcode pnpm run seed:zipcode:prod || {
  echo "Erro ao executar seed:zipcode:prod"
  exit 1
}

echo "Migrações concluídas com sucesso!"

touch /tmp/migrations-complete
echo "Arquivo de sinalização criado: /tmp/migrations-complete"

echo "Container mantido ativo..."
tail -f /dev/null
