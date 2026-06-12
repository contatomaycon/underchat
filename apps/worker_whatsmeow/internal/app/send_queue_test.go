package app

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/segmentio/kafka-go"
)

func TestKeyedSequencerRunsSameKeySequentially(t *testing.T) {
	sequencer := newKeyedSequencer()
	events := make(chan string, 4)

	first := sequencer.enqueue(context.Background(), context.Background(), "chat:a", time.Second, func(ctx context.Context) error {
		events <- "first-start"
		time.Sleep(10 * time.Millisecond)
		events <- "first-end"
		return nil
	})
	second := sequencer.enqueue(context.Background(), context.Background(), "chat:a", time.Second, func(ctx context.Context) error {
		events <- "second-run"
		return nil
	})

	if err := <-first; err != nil {
		t.Fatalf("first task failed: %v", err)
	}
	if err := <-second; err != nil {
		t.Fatalf("second task failed: %v", err)
	}

	got := []string{<-events, <-events, <-events}
	want := []string{"first-start", "first-end", "second-run"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("unexpected event order got=%v want=%v", got, want)
	}
}

func TestKeyedSequencerRunsDifferentKeysConcurrently(t *testing.T) {
	sequencer := newKeyedSequencer()
	firstStarted := make(chan struct{})
	releaseFirst := make(chan struct{})
	secondRan := make(chan struct{})

	first := sequencer.enqueue(context.Background(), context.Background(), "chat:a", time.Second, func(ctx context.Context) error {
		close(firstStarted)
		<-releaseFirst
		return nil
	})
	second := sequencer.enqueue(context.Background(), context.Background(), "chat:b", time.Second, func(ctx context.Context) error {
		close(secondRan)
		return nil
	})

	<-firstStarted
	select {
	case <-secondRan:
	case <-time.After(200 * time.Millisecond):
		t.Fatal("expected different queue key to run while first key is blocked")
	}
	close(releaseFirst)

	if err := <-first; err != nil {
		t.Fatalf("first task failed: %v", err)
	}
	if err := <-second; err != nil {
		t.Fatalf("second task failed: %v", err)
	}
}

func TestKeyedSequencerTimeoutReleasesChain(t *testing.T) {
	sequencer := newKeyedSequencer()

	first := sequencer.enqueue(context.Background(), context.Background(), "chat:a", time.Millisecond, func(ctx context.Context) error {
		<-ctx.Done()
		return ctx.Err()
	})
	if err := <-first; !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expected timeout, got %v", err)
	}

	secondRan := make(chan struct{})
	second := sequencer.enqueue(context.Background(), context.Background(), "chat:a", time.Second, func(ctx context.Context) error {
		close(secondRan)
		return nil
	})
	if err := <-second; err != nil {
		t.Fatalf("second task failed: %v", err)
	}
	select {
	case <-secondRan:
	default:
		t.Fatal("expected second task to run after timeout")
	}
}

func TestPartitionCommitCoordinatorWaitsForContiguousOffsets(t *testing.T) {
	var committed []int64
	coordinator := newPartitionCommitCoordinator(func(ctx context.Context, msg kafka.Message) error {
		committed = append(committed, msg.Offset)
		return nil
	})
	msg0 := kafka.Message{Topic: "worker.w1.send.message", Partition: 0, Offset: 0}
	msg1 := kafka.Message{Topic: "worker.w1.send.message", Partition: 0, Offset: 1}

	coordinator.register(msg0)
	coordinator.register(msg1)
	if ok, err := coordinator.complete(context.Background(), msg1); err != nil || ok {
		t.Fatalf("expected offset 1 commit to be deferred ok=%t err=%v", ok, err)
	}
	if len(committed) != 0 {
		t.Fatalf("expected no commits before offset 0, got %v", committed)
	}
	if ok, err := coordinator.complete(context.Background(), msg0); err != nil || !ok {
		t.Fatalf("expected contiguous commit ok=%t err=%v", ok, err)
	}
	if !reflect.DeepEqual(committed, []int64{1}) {
		t.Fatalf("unexpected committed offsets %v", committed)
	}
}

func TestPartitionCommitCoordinatorDoesNotCommitPastGap(t *testing.T) {
	var committed []int64
	coordinator := newPartitionCommitCoordinator(func(ctx context.Context, msg kafka.Message) error {
		committed = append(committed, msg.Offset)
		return nil
	})
	msg0 := kafka.Message{Topic: "worker.w1.send.message", Partition: 0, Offset: 0}
	msg1 := kafka.Message{Topic: "worker.w1.send.message", Partition: 0, Offset: 1}
	msg2 := kafka.Message{Topic: "worker.w1.send.message", Partition: 0, Offset: 2}

	coordinator.register(msg0)
	coordinator.register(msg1)
	coordinator.register(msg2)
	if ok, err := coordinator.complete(context.Background(), msg0); err != nil || !ok {
		t.Fatalf("expected offset 0 commit ok=%t err=%v", ok, err)
	}
	if ok, err := coordinator.complete(context.Background(), msg2); err != nil || ok {
		t.Fatalf("expected offset 2 commit to wait for gap ok=%t err=%v", ok, err)
	}
	if !reflect.DeepEqual(committed, []int64{0}) {
		t.Fatalf("unexpected commits before filling gap %v", committed)
	}
	if ok, err := coordinator.complete(context.Background(), msg1); err != nil || !ok {
		t.Fatalf("expected offset 1 to flush through offset 2 ok=%t err=%v", ok, err)
	}
	if !reflect.DeepEqual(committed, []int64{0, 2}) {
		t.Fatalf("unexpected final commits %v", committed)
	}
}

func TestWorkerSendQueueKeyUsesChatID(t *testing.T) {
	raw := []byte(`{"message_id":"m1","chat_id":"chat-a","phone":"5511999999999","account":{"id":"account-1"}}`)
	if got := workerSendQueueKey(raw); got != "chat:account-1:chat-a" {
		t.Fatalf("unexpected queue key %q", got)
	}
}

func TestWorkerSendQueueKeyFallsBackToMessageRemoteJID(t *testing.T) {
	raw := []byte(`{"message_id":"m1","message_key":{"remote_jid":"5511999999999@s.whatsapp.net"},"phone":"5511888888888","account":{"id":"account-1"}}`)
	if got := workerSendQueueKey(raw); got != "chat:account-1:5511999999999@s.whatsapp.net" {
		t.Fatalf("unexpected queue key %q", got)
	}
}

func TestWorkerSendQueueKeyFallsBackToPhone(t *testing.T) {
	raw := []byte(`{"message_id":"m1","phone":"5511999999999","account":{"id":"account-1"}}`)
	if got := workerSendQueueKey(raw); got != "chat:account-1:5511999999999" {
		t.Fatalf("unexpected queue key %q", got)
	}
}

func TestWorkerSendQueueKeyUsesProfileStatusKeyForProfilePayload(t *testing.T) {
	raw := []byte(`{"worker_id":"w1","account_id":"a1","worker_profile_status_id":"s1","value":"ola"}`)
	if got := workerSendQueueKey(raw); got != "profile_status:s1" {
		t.Fatalf("unexpected queue key %q", got)
	}
}

func TestWorkerSendQueueKeyUsesExternalIDForProfileStatusDelete(t *testing.T) {
	raw := []byte(`{"worker_id":"w1","account_id":"a1","worker_profile_status_id":"s1","external_id":"ext1"}`)
	if got := workerSendQueueKey(raw); got != "profile_status_delete:ext1" {
		t.Fatalf("unexpected queue key %q", got)
	}
}

func TestWorkerSendQueueKeyUsesWorkerAndAccountForProfileInfo(t *testing.T) {
	raw := []byte(`{"worker_id":"w1","account_id":"a1","name":"Atendimento"}`)
	if got := workerSendQueueKey(raw); got != "profile_info:w1:a1" {
		t.Fatalf("unexpected queue key %q", got)
	}
}

func TestKafkaMessageQueueKeyUsesScheduleAccountChannel(t *testing.T) {
	msg := kafka.Message{
		Topic: "worker.w1.schedule.send.message",
		Key:   []byte("schedule-key-that-must-not-order"),
		Value: []byte(`{"schedule_id":"sch1","contact_id":"c1","message":{"message_id":"m1","chat_id":"chat-a","account":{"id":"account-1"}}}`),
	}
	if got := kafkaMessageQueueKey(msg.Topic, msg); got != "account:account-1:channel:w1" {
		t.Fatalf("unexpected queue key %q", got)
	}
}

func TestKafkaMessageQueueKeyUsesDifferentScheduleQueuesPerChannel(t *testing.T) {
	raw := []byte(`{"schedule_id":"sch1","contact_id":"c1","message":{"message_id":"m1","chat_id":"chat-a","account":{"id":"account-1"}}}`)
	msgA := kafka.Message{Topic: "worker.w1.schedule.send.message", Value: raw}
	msgB := kafka.Message{Topic: "worker.w2.schedule.send.message", Value: raw}

	keyA := kafkaMessageQueueKey(msgA.Topic, msgA)
	keyB := kafkaMessageQueueKey(msgB.Topic, msgB)
	if keyA == keyB {
		t.Fatalf("expected different schedule queue keys per channel, got %q", keyA)
	}
	if keyB != "account:account-1:channel:w2" {
		t.Fatalf("unexpected second channel queue key %q", keyB)
	}
}

func TestKafkaMessageQueueKeyUsesNotificationDestination(t *testing.T) {
	msg := kafka.Message{
		Topic: "worker.w1.notification.message",
		Key:   []byte("notification-key-that-must-not-order"),
		Value: []byte(`{"notification_id":"n1","account":{"id":"a1"},"message_key":{"remote_jid":"5511999999999@s.whatsapp.net"},"message_whatsapp":"hello"}`),
	}
	if got := kafkaMessageQueueKey(msg.Topic, msg); got != "chat:a1:jid:5511999999999@s.whatsapp.net" {
		t.Fatalf("unexpected queue key %q", got)
	}
}

func TestKafkaMessageQueueKeyDoesNotSerializeMarkReadByJID(t *testing.T) {
	msg := kafka.Message{
		Topic:     topicMarkMessageRead,
		Key:       []byte("same-chat-key"),
		Partition: 2,
		Offset:    45,
		Value:     []byte(`{"account_id":"acc1","worker_id":"w1","keys":[{"remote_jid":"5511999999999@s.whatsapp.net","id":"m1"}]}`),
	}
	if got := kafkaMessageQueueKey(msg.Topic, msg); got != "offset:mark.message.read:2:45" {
		t.Fatalf("unexpected queue key %q", got)
	}
}
