package app

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type concurrentIncomingCallChatStore struct {
	mu          sync.Mutex
	chat        *incomingCallChat
	findCount   int
	findBarrier chan struct{}
}

func newConcurrentIncomingCallChatStore() *concurrentIncomingCallChatStore {
	return &concurrentIncomingCallChatStore{
		findBarrier: make(chan struct{}),
		chat: &incomingCallChat{Raw: map[string]any{
			"chat_id": "chat-1",
			"account": map[string]any{"id": "account-1", "name": "Conta"},
			"worker":  map[string]any{"id": "worker-1", "name": "Canal"},
			"contact": map[string]any{"name": "Contato"},
			"phone":   "5511999999999",
			"status":  "queue",
			"date":    time.Now().UTC().Format(time.RFC3339Nano),
			"user":    map[string]any{"id": "user-1", "name": "Atendente"},
			"sector":  map[string]any{"id": "sector-1", "name": "Suporte"},
		}},
	}
}

func (s *concurrentIncomingCallChatStore) FindOpenChat(context.Context, incomingCallTemplateInput) (*incomingCallChat, error) {
	s.mu.Lock()
	snapshot := s.chat.clone()
	s.findCount++
	if s.findCount == 2 {
		close(s.findBarrier)
	}
	s.mu.Unlock()
	<-s.findBarrier
	return snapshot, nil
}

func (s *concurrentIncomingCallChatStore) GetChat(context.Context, string, string) (*incomingCallChat, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.chat.clone(), nil
}

func (s *concurrentIncomingCallChatStore) PutProtocol(_ context.Context, _ string, protocol string, eventIDs []string) (incomingCallProtocolWriteResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.chat.protocol("protocol_start") != "" {
		return incomingCallProtocolNoop, nil
	}
	s.chat.Raw["protocol_start"] = []string{protocol}
	if len(eventIDs) > 0 {
		s.chat.Raw["meta"] = map[string]any{"outbound_webhook_event_ids": append([]string(nil), eventIDs...)}
	}
	return incomingCallProtocolUpdated, nil
}

func (s *concurrentIncomingCallChatStore) CacheChat(context.Context, *incomingCallChat) error {
	return nil
}

type concurrentIncomingCallOutbox struct {
	sequence    atomic.Int64
	mu          sync.Mutex
	prepared    []string
	complete    []string
	cancel      []string
	prepareErr  error
	completeErr error
}

func (o *concurrentIncomingCallOutbox) PrepareIncomingCallProtocolEvent(
	_ context.Context,
	_ incomingCallTemplateInput,
	_, _ *incomingCallChat,
	_ string,
) (*preparedIncomingCallProtocolEvent, error) {
	if o.prepareErr != nil {
		return nil, o.prepareErr
	}
	eventID := "event-" + strconv.FormatInt(o.sequence.Add(1), 10)
	o.mu.Lock()
	o.prepared = append(o.prepared, eventID)
	o.mu.Unlock()
	return &preparedIncomingCallProtocolEvent{EventID: eventID, OccurredAt: time.Now()}, nil
}

func (o *concurrentIncomingCallOutbox) CompleteIncomingCallProtocolEvent(
	_ context.Context,
	_ incomingCallTemplateInput,
	prepared *preparedIncomingCallProtocolEvent,
	_, _ *incomingCallChat,
	_ string,
) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.complete = append(o.complete, prepared.EventID)
	return o.completeErr
}

func TestIncomingCallProtocolWebhookFailuresDoNotAbortPrimaryMutation(t *testing.T) {
	for _, test := range []struct {
		name        string
		prepareErr  error
		completeErr error
	}{
		{name: "prepare", prepareErr: errors.New("outbox unavailable")},
		{name: "complete", completeErr: errors.New("outbox completion unavailable")},
	} {
		t.Run(test.name, func(t *testing.T) {
			store := newConcurrentIncomingCallChatStore()
			close(store.findBarrier)
			outbox := &concurrentIncomingCallOutbox{
				prepareErr:  test.prepareErr,
				completeErr: test.completeErr,
			}
			result, err := renderIncomingCallTemplateDirect(context.Background(), incomingCallTemplateInput{
				AccountID: "account-1", WorkerID: "worker-1",
				Template: "Protocolo {{protocol}}",
			}, store, outbox)
			if err != nil {
				t.Fatalf("webhook side effect aborted protocol mutation: %v", err)
			}
			if strings.Contains(result, "{{") || store.chat.protocol("protocol_start") == "" {
				t.Fatalf("protocol was not persisted/rendered: %q", result)
			}
		})
	}
}

func TestIncomingCallWebhookSanitizerRemovesCamelCaseSecretsAndInlineMedia(t *testing.T) {
	value := sanitizeIncomingCallWebhookValue(map[string]any{
		"accessToken":   "secret",
		"jpegThumbnail": "bytes",
		"safe":          "visible",
		"inline":        "data:image/jpeg;base64,AAAA",
		"nested":        map[string]any{"apiKey": "secret", "name": "ok"},
	}, 0)
	result, ok := value.(map[string]any)
	if !ok {
		t.Fatalf("unexpected sanitizer result: %#v", value)
	}
	if _, ok := result["accessToken"]; ok {
		t.Fatal("camelCase access token leaked")
	}
	if _, ok := result["jpegThumbnail"]; ok {
		t.Fatal("embedded thumbnail leaked")
	}
	if _, ok := result["inline"]; ok {
		t.Fatal("inline base64 media leaked")
	}
	if result["safe"] != "visible" {
		t.Fatalf("safe value was removed: %#v", result)
	}
	nested, _ := result["nested"].(map[string]any)
	if _, ok := nested["apiKey"]; ok || nested["name"] != "ok" {
		t.Fatalf("nested sanitizer mismatch: %#v", nested)
	}
}

func TestIncomingCallProtocolIdempotencyKeyMatchesCanonicalNodeContract(t *testing.T) {
	const expected = "8664e645f28367f598087956f06ee3e009a7ef3ced0f2573e5a6322a7b8e31f1"
	if got := incomingCallProtocolIdempotencyKey("chat-1", "202608011234567"); got != expected {
		t.Fatalf("incoming call protocol idempotency key = %q, want %q", got, expected)
	}
}

func (o *concurrentIncomingCallOutbox) CancelIncomingCallProtocolEvent(_ context.Context, eventID string) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.cancel = append(o.cancel, eventID)
	return nil
}

func TestIncomingCallProtocolConcurrentCASReturnsOneWinner(t *testing.T) {
	store := newConcurrentIncomingCallChatStore()
	outbox := &concurrentIncomingCallOutbox{}
	input := incomingCallTemplateInput{
		AccountID: "account-1", WorkerID: "worker-1",
		AccountName: "Conta", WorkerName: "Canal",
		CallPhone: "5511999999999",
		Template:  "P={{protocol}} U={{user}} S={{sector}}",
	}

	results := make(chan string, 2)
	errors := make(chan error, 2)
	for range 2 {
		go func() {
			result, err := renderIncomingCallTemplateDirect(context.Background(), input, store, outbox)
			results <- result
			errors <- err
		}()
	}
	first, second := <-results, <-results
	if err := <-errors; err != nil {
		t.Fatal(err)
	}
	if err := <-errors; err != nil {
		t.Fatal(err)
	}
	if first != second {
		t.Fatalf("concurrent renderers returned different winners: %q != %q", first, second)
	}
	if strings.Contains(first, "{{") || !strings.Contains(first, "Atendente") || !strings.Contains(first, "Suporte") {
		t.Fatalf("dynamic tags were not fully rendered: %q", first)
	}

	outbox.mu.Lock()
	defer outbox.mu.Unlock()
	if len(outbox.prepared) != 2 || len(outbox.complete) != 1 || len(outbox.cancel) != 1 {
		t.Fatalf("unexpected outbox lifecycle prepared=%v complete=%v cancelled=%v", outbox.prepared, outbox.complete, outbox.cancel)
	}
	if outbox.complete[0] == outbox.cancel[0] {
		t.Fatalf("winner event was cancelled: %q", outbox.complete[0])
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	markers := store.chat.webhookMarkers()
	if len(markers) != 1 || markers[0] != outbox.complete[0] {
		t.Fatalf("only the winner marker must remain, got %v", markers)
	}
}

func TestNormalizeIncomingCallIdentityKeepsBrazilAndJIDAliases(t *testing.T) {
	identity := normalizeIncomingCallIdentity("+55 (11) 99999-9999", "5511999999999:4@c.us")
	if len(identity.PhoneCandidates) != 2 || identity.PhoneCandidates[0] != "5511999999999" || identity.PhoneCandidates[1] != "551199999999" {
		t.Fatalf("unexpected phone candidates: %v", identity.PhoneCandidates)
	}
	wantJIDs := map[string]bool{
		"5511999999999@s.whatsapp.net": true,
		"5511999999999@c.us":           true,
		"551199999999@s.whatsapp.net":  true,
		"551199999999@c.us":            true,
	}
	for _, candidate := range identity.JIDCandidates {
		delete(wantJIDs, candidate)
	}
	if len(wantJIDs) != 0 {
		t.Fatalf("missing JID aliases: %v (got %v)", wantJIDs, identity.JIDCandidates)
	}
}
