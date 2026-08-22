package app

import (
	"context"
	"testing"

	"github.com/segmentio/kafka-go"
)

// captureAuthorizedKafkaContext builds the internal command-adapter context
// used by JetStream command tests. kafka.Message remains the mature handler
// DTO; this helper does not start or depend on a Kafka consumer.
func captureAuthorizedKafkaContext(t *testing.T, worker *Worker) context.Context {
	t.Helper()
	var captured context.Context
	handler := worker.authorizedKafkaHandler(func(ctx context.Context, _ kafka.Message) error {
		captured = ctx
		return nil
	})
	if err := handler(context.Background(), kafka.Message{
		Topic:     "worker-command-adapter",
		Partition: 0,
		Offset:    1,
	}); err != nil {
		t.Fatalf("capture authorized command context: %v", err)
	}
	if captured == nil {
		t.Fatal("authorized command context was not captured")
	}
	return captured
}
