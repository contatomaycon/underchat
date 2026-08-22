---
title: Limites de requisição
description: Entenda a janela padrão de 120 requisições por minuto por token.
---

# Limites de requisição

Por padrão, cada token pode fazer **120 requisições por minuto**. O valor é
configurável pelo ambiente da API e compartilhado por todos os processos e usuários
executores que usam a mesma credencial. Alternar `x-underchat-user-id` não cria uma
nova cota.

## Headers de limite

As respostas informam a capacidade da janela por headers HTTP. Observe os valores
publicados pelo ambiente:

| Header                  | Descrição                                               |
| ----------------------- | ------------------------------------------------------- |
| `X-RateLimit-Limit`     | Limite total da janela.                                 |
| `X-RateLimit-Remaining` | Requisições ainda disponíveis.                          |
| `X-RateLimit-Reset`     | Momento ou intervalo para renovação, conforme resposta. |
| `Retry-After`           | Segundos que devem ser aguardados após um `429`.        |

Ao exceder a cota, a API responde `429 Too Many Requests` sem executar a operação.

## Tratamento recomendado

```js
async function requestWithBackoff(url, options, attempt = 0) {
  const response = await fetch(url, options);

  if (response.status !== 429 || attempt >= 3) return response;

  const retryAfter = Number(response.headers.get('retry-after') ?? 1);
  const jitter = Math.floor(Math.random() * 250);
  await new Promise((resolve) =>
    setTimeout(resolve, retryAfter * 1000 + jitter)
  );

  return requestWithBackoff(url, options, attempt + 1);
}
```

Antes de repetir uma escrita, avalie se a tentativa anterior foi realmente
rejeitada. Uma resposta `429` é segura para retry porque a operação não passou pelo
handler; timeouts após o envio são ambíguos.

## Distribua a carga

- use uma fila única por token para controlar concorrência;
- aplique leitura incremental e paginação, em vez de varrer tudo a cada ciclo;
- armazene IDs e estados já sincronizados;
- consolide mudanças em lote quando houver endpoint específico;
- não use polling agressivo para eventos que podem chegar por webhook;
- monitore `remaining` antes de iniciar tarefas grandes.

## O que não fazer

Não gere ou compartilhe múltiplos tokens para contornar o limite. Existe somente um
token ativo por conta; rotacionar a chave não deve ser usado como mecanismo de
capacidade. Se 120 req/min não atendem ao fluxo esperado, alinhe a configuração do
ambiente com a equipe responsável pela API.
