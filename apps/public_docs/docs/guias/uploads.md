---
title: Uploads e mídia
description: Como enviar imagens, documentos, vídeos e áudios em mensagens.
---

# Uploads e mídia

O envio de mensagens em `POST /v1/chat/:chat_id` aceita JSON para mensagens simples
e `multipart/form-data` quando há arquivos. O limite máximo é configurado por
ambiente; uma carga acima dele retorna `413 Payload Too Large`.

## Tipos de mídia

| `type`                  | Campo multipart principal | Campos relacionados                              |
| ----------------------- | ------------------------- | ------------------------------------------------ |
| `image`                 | `images`                  | `message`, `message_quoted_id`                   |
| `document`              | `documents`               | `message`, `message_quoted_id`                   |
| `video` ou `video_note` | `videos`                  | `video_duration`, `message`                      |
| `audio`                 | `audios`                  | `audio_duration`, `audio_view_once`, `audio_ptt` |

Os enums exatos e formatos aceitos pelo canal aparecem na referência do endpoint.
Uma mídia suportada pela API ainda pode ser recusada pelo provedor/canal conforme
tipo MIME, tamanho, duração ou janela da conversa.

## Exemplo: imagem com legenda

```bash
curl --request POST \
  --url "$UNDERCHAT_API_URL/v1/chat/$CHAT_ID" \
  --header "keyapi: $UNDERCHAT_API_TOKEN" \
  --header "x-underchat-user-id: $UNDERCHAT_USER_ID" \
  --form "type=image" \
  --form "message=Comprovante recebido" \
  --form "images=@./comprovante.jpg;type=image/jpeg"
```

Não defina manualmente o boundary de `Content-Type`: `curl`, `FormData` e clientes
HTTP fazem isso ao serializar o multipart.

## Exemplo: documento

```js
import { openAsBlob } from 'node:fs';

const body = new FormData();
body.set('type', 'document');
body.set('message', 'Contrato para conferência');
body.set(
  'documents',
  await openAsBlob('./contrato.pdf', { type: 'application/pdf' }),
  'contrato.pdf'
);

const response = await fetch(
  `${process.env.UNDERCHAT_API_URL}/v1/chat/${chatId}`,
  {
    method: 'POST',
    headers: {
      keyapi: process.env.UNDERCHAT_API_TOKEN,
      'x-underchat-user-id': process.env.UNDERCHAT_USER_ID,
    },
    body,
  }
);
```

## Áudio

- `audio_duration`: duração em segundos, quando exigida pelo canal;
- `audio_view_once`: indica mídia de visualização única quando suportado;
- `audio_ptt`: solicita tratamento como mensagem de voz/PTT;
- `message_quoted_id`: referencia a mensagem respondida.

Valores multipart chegam como texto; o schema aceita representações compatíveis em
campos específicos. Envie `true`/`false` em minúsculas e números sem unidades.

## Mensagens sem arquivo

Para texto, envie JSON:

```bash
curl --request POST \
  --url "$UNDERCHAT_API_URL/v1/chat/$CHAT_ID" \
  --header "Content-Type: application/json" \
  --header "keyapi: $UNDERCHAT_API_TOKEN" \
  --header "x-underchat-user-id: $UNDERCHAT_USER_ID" \
  --data '{
    "type": "text",
    "message": "Olá! Como podemos ajudar?"
  }'
```

## Cuidados operacionais

- valide MIME e tamanho antes do upload;
- aplique timeout maior para mídia, mas sempre finito;
- não repita automaticamente um `POST` após resposta incerta;
- mantenha o arquivo disponível até receber uma resposta conclusiva;
- não envie paths locais ou URLs no lugar do binário multipart;
- verifique a resposta para identificar falhas específicas do canal.

::: warning Dados sensíveis
Arquivos podem conter informações pessoais. Restrinja logs, retenção temporária e
acesso ao storage usado pela integração, seguindo a política de privacidade da sua
operação.
:::
