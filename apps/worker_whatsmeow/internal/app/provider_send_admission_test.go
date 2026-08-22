package app

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestOutboundProviderAdmissionBoundsAvalanche(t *testing.T) {
	const (
		capacity = 4
		total    = 64
	)
	worker := &Worker{cfg: Config{ProviderSendMaxInFlight: capacity}}
	start := make(chan struct{})
	releaseWave := make(chan struct{})
	entered := make(chan struct{}, total)
	errs := make(chan error, total)

	var active atomic.Int32
	var maximum atomic.Int32
	var providerCalls atomic.Int32
	var waitGroup sync.WaitGroup
	waitGroup.Add(total)
	for index := 0; index < total; index++ {
		go func() {
			defer waitGroup.Done()
			<-start
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			release, err := worker.acquireOutboundProviderAdmission(ctx)
			if err != nil {
				errs <- err
				return
			}
			defer release()

			providerCalls.Add(1)
			current := active.Add(1)
			for {
				observed := maximum.Load()
				if current <= observed || maximum.CompareAndSwap(observed, current) {
					break
				}
			}
			entered <- struct{}{}
			<-releaseWave
			active.Add(-1)
		}()
	}

	close(start)
	for index := 0; index < capacity; index++ {
		select {
		case <-entered:
		case err := <-errs:
			t.Fatalf("provider admission failed before reaching capacity: %v", err)
		case <-time.After(time.Second):
			t.Fatal("provider avalanche did not fill the configured admission capacity")
		}
	}
	select {
	case <-entered:
		t.Fatal("provider avalanche crossed the configured admission capacity")
	case err := <-errs:
		t.Fatalf("provider admission failed while first wave was blocked: %v", err)
	case <-time.After(40 * time.Millisecond):
	}

	close(releaseWave)
	waitGroup.Wait()
	close(errs)
	for err := range errs {
		t.Fatalf("provider admission failed: %v", err)
	}
	if got := providerCalls.Load(); got != total {
		t.Fatalf("provider calls=%d, want %d", got, total)
	}
	if got := maximum.Load(); got != capacity {
		t.Fatalf("maximum concurrent provider calls=%d, want %d", got, capacity)
	}
	if got := active.Load(); got != 0 {
		t.Fatalf("active provider calls leaked: %d", got)
	}
}

func TestOutboundProviderAdmissionBackpressureCancelsBeforeProvider(t *testing.T) {
	worker := &Worker{cfg: Config{ProviderSendMaxInFlight: 1}}
	releaseFirst, err := worker.acquireOutboundProviderAdmission(context.Background())
	if err != nil {
		t.Fatalf("acquire first provider admission: %v", err)
	}

	var providerCalls atomic.Int32
	waitCtx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	releaseSecond, err := worker.acquireOutboundProviderAdmission(waitCtx)
	if releaseSecond != nil {
		releaseSecond()
	}
	if !errors.Is(err, errOutboundProviderAdmissionUnavailable) ||
		!errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("blocked admission error=%v, want admission unavailable + deadline", err)
	}
	if got := providerCalls.Load(); got != 0 {
		t.Fatalf("provider crossed the admission boundary %d times", got)
	}

	releaseFirst()
	// Release is deliberately idempotent so deferred and immediate cleanup can
	// safely coexist in every outbound handler.
	releaseFirst()

	releaseAfterRecovery, err := worker.acquireOutboundProviderAdmission(context.Background())
	if err != nil {
		t.Fatalf("admission did not recover after release: %v", err)
	}
	providerCalls.Add(1)
	releaseAfterRecovery()
	if got := providerCalls.Load(); got != 1 {
		t.Fatalf("provider calls after recovery=%d, want 1", got)
	}
}
