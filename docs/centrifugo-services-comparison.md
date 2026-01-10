# Comparação: CentrifugoService vs PresenceCentrifugoService

## 📋 Visão Geral

O sistema agora possui **dois serviços especializados** para diferentes casos de uso:

1. **CentrifugoService** - Para mensagens de chat (alta throughput)
2. **PresenceCentrifugoService** - Para status de presença (rate limit conservador)

---

## 🎯 Casos de Uso

### CentrifugoService (Principal)

**Usado para:**

- ✅ Mensagens de chat
- ✅ Notificações de conversa
- ✅ Atualizações em tempo real de mensagens
- ✅ Qualquer evento de alta frequência no chat

**Características:**

- Suporta **infinitos chats simultâneos**
- Alta throughput para sistema de chat em escala
- Rate limiting mais permissivo

### PresenceCentrifugoService

**Usado para:**

- ✅ Status de presença de usuários (online/offline/away/busy)
- ✅ Heartbeats de presença
- ✅ Sincronização de status

**Características:**

- Rate limiting conservador (evita sobrecarga)
- Cache agressivo de deduplicação
- Otimizado para status que mudam com menos frequência

---

## ⚙️ Comparação Técnica

| Configuração                  | CentrifugoService | PresenceCentrifugoService |
| ----------------------------- | ----------------- | ------------------------- |
| **Rate Limit**                | 1.000 msgs/s      | 100 msgs/s                |
| **Debounce**                  | 50ms              | 100ms                     |
| **Cache Window**              | 2 segundos        | 5 segundos                |
| **Queue Processing**          | 25ms              | 50ms                      |
| **HTTP Timeout**              | 15 segundos       | 20 segundos               |
| **Circuit Breaker Threshold** | 50 falhas         | 10 falhas                 |
| **Circuit Breaker Reset**     | 20 segundos       | 30 segundos               |
| **Retry Base Delay**          | 300ms             | 500ms                     |
| **Retry Max Delay**           | 2 segundos        | 4 segundos                |
| **Queue Overflow Alert**      | 1.000 itens       | 500 itens                 |
| **Cache Cleanup**             | 5 segundos        | 10 segundos               |

---

## 🚀 CentrifugoService (Alta Performance)

### Configuração Otimizada para Chat

```typescript
// Alta throughput
private readonly rateLimitPerSecond = 1_000;  // 1k msgs/s

// Debounce rápido
private readonly debounceWindowMs = 50;  // 50ms

// Cache curto (mensagens não duplicam tanto)
private readonly publishCacheWindowMs = 2_000;  // 2s

// Processamento ágil
private readonly queueProcessIntervalMs = 25;  // 25ms

// Circuit breaker tolerante
private readonly circuitBreakerThreshold = 50;  // 50 falhas

// Retry rápido
private readonly publishRetryBaseDelayMs = 300;  // 300ms
private readonly publishRetryMaxDelayMs = 2_000;  // 2s

// Timeout médio
private readonly httpApiTimeoutMs = 15_000;  // 15s
```

### Métricas Esperadas

```
Throughput: Até 1.000 mensagens/segundo
Latência P95: < 100ms
Latência P99: < 500ms
Taxa de deduplicação: ~5-10%
Tempo de fila: < 1 segundo
```

### Logs

Prefixo: `centrifugo_*`

```typescript
// Exemplos
centrifugo_publish_error;
centrifugo_circuit_breaker_open;
centrifugo_queue_overflow;
centrifugo_publish_deduplicated;
```

---

## 🐢 PresenceCentrifugoService (Conservador)

### Configuração Otimizada para Presence

```typescript
// Rate limit conservador
private readonly rateLimitPerSecond = 100;  // 100 msgs/s

// Debounce maior (status não muda tão rápido)
private readonly debounceWindowMs = 100;  // 100ms

// Cache longo (status duplica muito)
private readonly publishCacheWindowMs = 5_000;  // 5s

// Processamento mais espaçado
private readonly queueProcessIntervalMs = 50;  // 50ms

// Circuit breaker rigoroso
private readonly circuitBreakerThreshold = 10;  // 10 falhas

// Retry com backoff maior
private readonly publishRetryBaseDelayMs = 500;  // 500ms
private readonly publishRetryMaxDelayMs = 4_000;  // 4s

// Timeout generoso
private readonly httpApiTimeoutMs = 20_000;  // 20s
```

### Métricas Esperadas

```
Throughput: Até 100 status updates/segundo
Latência P95: < 200ms
Latência P99: < 1s
Taxa de deduplicação: ~80-90% (muito alta!)
Tempo de fila: < 5 segundos
```

### Logs

Prefixo: `presence_centrifugo_*`

```typescript
// Exemplos
presence_centrifugo_publish_error;
presence_centrifugo_circuit_breaker_open;
presence_centrifugo_queue_overflow;
presence_centrifugo_publish_sub_deduplicated;
```

---

## 💡 Por que Separar?

### Problema Original

Com um único serviço:

- ❌ Presence (baixa frequência) competia por tokens com chat (alta frequência)
- ❌ Cache curto não evitava duplicatas de status
- ❌ Rate limit muito alto era perigoso para presence
- ❌ Rate limit muito baixo sufocava o chat

### Solução Atual

Com serviços separados:

- ✅ Cada caso de uso tem configurações otimizadas
- ✅ Presence não consome tokens do chat
- ✅ Chat pode escalar infinitamente
- ✅ Presence protegido contra sobrecarga

---

## 📊 Exemplo de Uso

### Chat Messages (CentrifugoService)

```typescript
@injectable()
export class ChatMessageService {
  constructor(private readonly centrifugoService: CentrifugoService) {}

  async publishNewMessage(chatId: string, message: Message) {
    await this.centrifugoService.publish(`chat:${chatId}`, {
      event: 'new_message',
      message,
    });
  }
}
```

### User Presence (PresenceCentrifugoService)

```typescript
@injectable()
export class PresenceService {
  constructor(
    private readonly presenceCentrifugoService: PresenceCentrifugoService
  ) {}

  async publishUserStatus(userId: string, status: string) {
    await this.presenceCentrifugoService.publishSub(`user:presence#${userId}`, {
      event: 'user_presence',
      status,
    });
  }
}
```

---

## 🔍 Monitoramento

### Queries para CentrifugoService

```
# Timeouts
type:centrifugo_publish_error AND message:timeout

# Circuit breaker
type:centrifugo_circuit_breaker_open

# Fila grande
type:centrifugo_queue_overflow AND queueSize > 1000

# Taxa de deduplicação
rate(centrifugo_publish_deduplicated) / rate(total_publish) * 100
```

### Queries para PresenceCentrifugoService

```
# Timeouts
type:presence_centrifugo_publish_error AND message:timeout

# Circuit breaker
type:presence_centrifugo_circuit_breaker_open

# Fila grande
type:presence_centrifugo_queue_overflow AND queueSize > 500

# Taxa de deduplicação (esperado: > 80%)
rate(presence_centrifugo_publish_sub_deduplicated) / rate(total_presence_publish) * 100
```

---

## 📈 Escalabilidade

### CentrifugoService

**Suporta:**

```
1.000 msgs/s × 60s = 60.000 mensagens/minuto
60.000 × 60 = 3.600.000 mensagens/hora
```

**Picos:**

- Com fila: pode absorver bursts de até 5.000 msgs/s por curtos períodos
- Circuit breaker protege após 50 falhas consecutivas

### PresenceCentrifugoService

**Suporta:**

```
100 status/s × 60s = 6.000 status updates/minuto
6.000 × 60 = 360.000 status updates/hora
```

**Deduplicação:**

- ~80-90% das requisições são deduplicas
- Throughput efetivo: ~10-20 msgs/s para o Centrifugo
- Protege completamente contra heartbeat storms

---

## 🎛️ API de Estatísticas

### CentrifugoService

```typescript
const stats = centrifugoService.getQueueStats();

console.log(stats);
// {
//   queueSize: 145,
//   availableTokens: 823,
//   isProcessing: true,
//   debouncePending: 23,
//   cacheSize: 456,
//   circuitBreakerFailures: 2,
//   circuitBreakerOpen: false
// }
```

### PresenceCentrifugoService

```typescript
const stats = presenceCentrifugoService.getQueueStats();

console.log(stats);
// {
//   queueSize: 12,
//   availableTokens: 89,
//   isProcessing: false,
//   debouncePending: 5,
//   cacheSize: 1234,  // Cache grande (5s window)
//   circuitBreakerFailures: 0,
//   circuitBreakerOpen: false
// }
```

---

## 🔧 Ajuste Fino

### Quando Aumentar Rate Limit do Chat

Se observar:

- ✅ Fila crescendo consistentemente
- ✅ Latência alta (P99 > 1s)
- ✅ Tokens sempre em 0

Ajustar:

```typescript
// Em centrifugo.service.ts
private readonly rateLimitPerSecond = 2_000;  // Era 1.000
```

### Quando Diminuir Rate Limit do Presence

Se observar:

- ✅ Circuit breaker abrindo frequentemente
- ✅ Timeouts > 10%
- ✅ Centrifugo sob carga

Ajustar:

```typescript
// Em presence-centrifugo.service.ts
private readonly rateLimitPerSecond = 50;  // Era 100
```

---

## 📝 Checklist de Migração

- [x] Criar `PresenceCentrifugoService`
- [x] Atualizar `PresenceService` para usar novo serviço
- [x] Ajustar rate limits do `CentrifugoService`
- [x] Configurar logs separados
- [ ] Configurar alertas separados em produção
- [ ] Criar dashboards separados
- [ ] Validar em desenvolvimento
- [ ] Deploy gradual em produção
- [ ] Monitorar métricas pós-deploy

---

## 🎯 Benefícios da Separação

### Performance

- ✅ Chat: 10x mais throughput (100 → 1.000 msgs/s)
- ✅ Presence: 90% redução de carga no Centrifugo (deduplicação)
- ✅ Sem competição por recursos

### Confiabilidade

- ✅ Falhas em presence não afetam chat
- ✅ Circuit breakers independentes
- ✅ Recuperação isolada

### Observabilidade

- ✅ Logs separados por contexto
- ✅ Métricas específicas para cada uso
- ✅ Troubleshooting mais fácil

### Manutenção

- ✅ Ajuste fino independente
- ✅ Configurações específicas para cada caso
- ✅ Testes isolados

---

**Criado:** Janeiro 2026  
**Versão:** 1.0  
**Status:** ✅ Implementado
