package app

import "testing"

func TestMessageUpdateIdentityMatchesSharedTypeScriptContract(t *testing.T) {
	update := UpdateMessage{
		WorkerID: "worker-1",
		Message: map[string]any{
			"key": map[string]any{"id": "provider-stanza-1"},
		},
		Data: ChatMessage{
			MessageID: "internal-message-1",
			Account:   map[string]any{"id": "account-1"},
			Worker:    map[string]any{"id": "worker-1"},
		},
	}
	const expected = "message_update_v1_885294cba87fde2a6c8af80cc84da18c48d77af53d49e9abd37f3e9e4e6fd956"
	if got := ensureMessageUpdateEventID(&update); got != expected {
		t.Fatalf("Go identity diverged from shared TypeScript contract: %q", got)
	}

	serialized := update
	serialized.EventID = ""
	serialized.Message = map[string]any{
		"key": map[string]any{
			"id": "true_5511999999999@s.whatsapp.net_provider-stanza-1",
		},
	}
	if got := ensureMessageUpdateEventID(&serialized); got != expected {
		t.Fatalf("serialized provider id did not canonicalize: %q", got)
	}
}
