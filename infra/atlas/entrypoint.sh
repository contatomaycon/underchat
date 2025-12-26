#!/bin/sh

set -e

mkdir -p /.cache/node/corepack
chmod -R 777 /.cache 2>/dev/null || true

if [ -z "$DB_ATLAS" ]; then
  echo "Aviso: DB_ATLAS não está definido, pulando migrações"
  touch /tmp/migrations-complete
  tail -f /dev/null
  exit 0
fi

if [ -z "$DB_DATABASE_URL" ]; then
  echo "Aviso: DB_DATABASE_URL não está definido, pulando migrações"
  touch /tmp/migrations-complete
  tail -f /dev/null
  exit 0
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