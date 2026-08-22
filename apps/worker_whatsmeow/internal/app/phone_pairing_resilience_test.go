package app

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"go.mau.fi/whatsmeow"
)

func TestPhonePairingUsesDefaultDeadlineWithoutNewConfiguration(t *testing.T) {
	client := &whatsmeow.Client{}
	manager := &WhatsAppManager{
		cfg:    Config{WorkerID: "worker-pair-default"},
		client: client,
	}
	code, err := invokeWhatsmeowPhonePairing(
		context.Background(),
		manager,
		client,
		"5511999999999",
		func(
			ctx context.Context,
			_ *whatsmeow.Client,
			_ string,
		) (string, error) {
			deadline, ok := ctx.Deadline()
			if !ok {
				return "", errors.New("phone pairing provider context has no deadline")
			}
			remaining := time.Until(deadline)
			if remaining < 40*time.Second || remaining > 46*time.Second {
				return "", errors.New("phone pairing did not use the existing default deadline")
			}
			return "1234-5678", nil
		},
	)
	if err != nil {
		t.Fatalf("phone pairing with default configuration failed: %v", err)
	}
	if code != "1234-5678" {
		t.Fatalf("unexpected phone pairing code %q", code)
	}
}

func TestPhonePairingTimeoutQuarantinesExactClientAndDoesNotReplay(t *testing.T) {
	client := &whatsmeow.Client{}
	manager := &WhatsAppManager{
		cfg: Config{
			WorkerID:    "worker-pair-timeout",
			SendTimeout: 20 * time.Millisecond,
		},
		client: client,
	}
	release := make(chan struct{})
	returned := make(chan struct{})
	var calls atomic.Int32

	startedAt := time.Now()
	_, err := invokeWhatsmeowPhonePairing(
		context.Background(),
		manager,
		client,
		"5511999999999",
		func(
			_ context.Context,
			_ *whatsmeow.Client,
			_ string,
		) (string, error) {
			calls.Add(1)
			<-release // Deliberately ignores the provider context.
			close(returned)
			return "late-code", nil
		},
	)
	if !errors.Is(err, errOutboundProviderCallStalled) {
		t.Fatalf("context-ignoring PairPhone was not timed out: %v", err)
	}
	if elapsed := time.Since(startedAt); elapsed > 500*time.Millisecond {
		t.Fatalf("PairPhone exceeded its hard application deadline: %s", elapsed)
	}
	if !manager.isProviderClientStalled(client) {
		t.Fatal("timed-out PairPhone client was not quarantined")
	}

	_, err = invokeWhatsmeowPhonePairing(
		context.Background(),
		manager,
		client,
		"5511999999999",
		func(
			context.Context,
			*whatsmeow.Client,
			string,
		) (string, error) {
			calls.Add(1)
			return "unexpected-replay", nil
		},
	)
	if !errors.Is(err, errWhatsmeowProviderClientFenced) {
		t.Fatalf("quarantined PairPhone client accepted another call: %v", err)
	}
	if got := calls.Load(); got != 1 {
		t.Fatalf("PairPhone provider call count=%d, want 1", got)
	}

	close(release)
	select {
	case <-returned:
	case <-time.After(time.Second):
		t.Fatal("late PairPhone result was not observed")
	}
	time.Sleep(10 * time.Millisecond)
	if !manager.isProviderClientStalled(client) {
		t.Fatal("late PairPhone success cleared the client quarantine")
	}
}

func TestPhonePairingRejectsConcurrentDuplicateUntilProviderSettles(t *testing.T) {
	client := &whatsmeow.Client{}
	manager := &WhatsAppManager{
		cfg: Config{
			WorkerID:    "worker-pair-single-flight",
			SendTimeout: time.Second,
		},
		client: client,
	}
	started := make(chan struct{})
	release := make(chan struct{})
	firstResult := make(chan error, 1)
	go func() {
		_, err := invokeWhatsmeowPhonePairing(
			context.Background(),
			manager,
			client,
			"5511999999999",
			func(
				context.Context,
				*whatsmeow.Client,
				string,
			) (string, error) {
				close(started)
				<-release
				return "1234-5678", nil
			},
		)
		firstResult <- err
	}()

	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("first PairPhone call did not start")
	}
	_, err := invokeWhatsmeowPhonePairing(
		context.Background(),
		manager,
		client,
		"5511999999999",
		func(
			context.Context,
			*whatsmeow.Client,
			string,
		) (string, error) {
			return "duplicate", nil
		},
	)
	if !errors.Is(err, errWhatsmeowProviderCallInFlight) {
		t.Fatalf("concurrent PairPhone duplicate was admitted: %v", err)
	}

	close(release)
	select {
	case err := <-firstResult:
		if err != nil {
			t.Fatalf("first PairPhone call failed: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("first PairPhone call did not settle")
	}
}
