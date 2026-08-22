# Forks vendorizados

Este diretório contém código de dependências externas vendorizadas.

- `whatsmeow/`: fork local de `/home/maycon/whatsmeow`, usado via `replace go.mau.fi/whatsmeow => ./forks/whatsmeow`.
- `kafka-go/`: cópia pinada de `github.com/segmentio/kafka-go` v0.4.48
  (checksum Go
  `h1:9jyu9CWK4W5W+SroCe8EffbrRZVqAOkuaLd/ApID4Vs=`, licença MIT
  preservada), usada via `replace`. A única mudança funcional impede
  `Conn.ReadPartitions` de solicitar auto-criação de tópicos e recusa consultas
  específicas quando o broker não suporta Metadata v6. Essa operação é
  compartilhada por `ConsumerGroup`, `DialLeader` e readers de partição;
  portanto um tópico durável ausente falha fechado e só pode ser recriado pela
  fronteira administrativa autorizada da UnderChat. A atribuição local da
  variável de tabela em `reader_test.go` é apenas compatibilidade do `go vet`
  com o toolchain atual.

O código próprio do worker fica fora desta pasta, em `cmd/` e `internal/`.
