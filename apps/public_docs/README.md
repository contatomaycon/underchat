# Underchat Developers

Portal público em PT-BR para a API PUBLIC da Underchat. Os guias são gerados pelo
VitePress e a referência interativa é carregada diretamente do OpenAPI servido pela
API.

## Desenvolvimento

1. Copie `.env.example` para `.env` e ajuste `VITE_API_PUBLIC_URL`.
2. Instale as dependências a partir da raiz do monorepo.
3. Execute `pnpm --filter public_docs dev`.

Comandos disponíveis:

- `pnpm --filter public_docs dev`
- `pnpm --filter public_docs typecheck`
- `pnpm --filter public_docs build`
- `pnpm --filter public_docs preview`

O build estático é gravado em `apps/public_docs/dist`. A API configurada precisa
servir `GET /docs/openapi.json` e autorizar por CORS a origem deste portal.

## Build do container

O build de produção exige a origem pública explicitamente, sem `/v1` ou barra
final. A URL é incorporada aos arquivos estáticos e não pode ser alterada apenas
com uma variável no container já iniciado.

```bash
docker build \
  --build-arg VITE_API_PUBLIC_URL=https://api-public.underchat.com.br \
  --file apps/public_docs/Dockerfile \
  .
```

O build falha quando `VITE_API_PUBLIC_URL` está ausente, não usa HTTPS, aponta
para localhost ou contém caminho, query, fragmento ou credenciais. Isso evita
publicar o portal apontando para uma origem local, insegura ou incorreta.
