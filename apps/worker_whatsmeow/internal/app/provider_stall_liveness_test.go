package app

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/types/events"
)

func TestWorkerLivenessPreservesWarmPairingAndExternalDegradation(t *testing.T) {
	now := time.Now()
	for name, manager := range map[string]*WhatsAppManager{
		"warm_without_manager": nil,
		"pairing": {
			cfg:  Config{WorkerID: "worker-pairing-passive"},
			code: CodeAwaitingPairingCode,
		},
		"ordinary_external_degradation": {
			cfg:            Config{WorkerID: "worker-external-degraded"},
			degradedReason: "client_socket_disconnected",
		},
	} {
		t.Run(name, func(t *testing.T) {
			statusCode, health := workerProcessLiveness(manager, now)
			if statusCode != http.StatusOK {
				t.Fatalf("passive/external state changed process liveness: %d", statusCode)
			}
			if health["status"] != "ok" {
				t.Fatalf("unexpected healthy liveness payload: %#v", health)
			}
		})
	}
}

func TestQuarantinedContextIgnoringProviderBecomesFatalAfterGrace(t *testing.T) {
	client := &whatsmeow.Client{}
	manager := &WhatsAppManager{
		cfg:    Config{WorkerID: "worker-provider-orphan"},
		client: client,
	}
	manager.markProviderClientStalled(client)
	if _, err := manager.acquireProviderClientFlight(
		client,
		"provider_call_after_quarantine",
	); !errors.Is(err, errWhatsmeowProviderClientFenced) {
		t.Fatalf("quarantined client admitted another potential orphan: %v", err)
	}

	stalledAt := time.Now()
	manager.providerFlightMu.Lock()
	manager.providerStalledAt = stalledAt
	manager.providerFlightMu.Unlock()

	statusCode, health := workerProcessLiveness(
		manager,
		stalledAt.Add(providerStallLivenessGrace-time.Nanosecond),
	)
	if statusCode != http.StatusOK || health["status"] != "ok" {
		t.Fatalf("provider stall bypassed replacement grace: code=%d health=%#v", statusCode, health)
	}

	statusCode, health = workerProcessLiveness(
		manager,
		stalledAt.Add(providerStallLivenessGrace),
	)
	if statusCode != http.StatusServiceUnavailable {
		t.Fatalf("infinite provider orphan remained live after grace: %d", statusCode)
	}
	if health["fatal_runtime"] != true ||
		health["reason"] != "context_ignoring_provider_call_quarantined" {
		t.Fatalf("unexpected fatal liveness payload: %#v", health)
	}
}

func TestProviderStallFatalFallbackIsStickyAcrossLocalClientReplacement(t *testing.T) {
	stalledClient := &whatsmeow.Client{}
	manager := &WhatsAppManager{
		cfg:    Config{WorkerID: "worker-provider-sticky-fatal"},
		client: stalledClient,
	}
	manager.markProviderClientStalled(stalledClient)

	stalledAt := time.Now().Add(-providerStallLivenessGrace)
	manager.providerFlightMu.Lock()
	manager.providerStalledAt = stalledAt
	manager.providerFlightMu.Unlock()
	manager.mu.Lock()
	manager.client = &whatsmeow.Client{}
	manager.mu.Unlock()

	statusCode, health := workerProcessLiveness(manager, time.Now())
	if statusCode != http.StatusServiceUnavailable {
		t.Fatalf("local client replacement hid the old provider orphan: %d", statusCode)
	}
	if health["fatal_runtime"] != true {
		t.Fatalf("old provider orphan did not remain fatal: %#v", health)
	}
}

func TestProviderProcessQuarantineBlocksEveryInProcessReactivationPath(t *testing.T) {
	client := &whatsmeow.Client{}
	activationCalls := 0
	recoveryRotationCalls := 0
	manager := &WhatsAppManager{
		cfg: Config{
			WorkerID:          "worker-provider-reactivation-fence",
			RuntimeGeneration: 9,
		},
		client: client,
		activateRuntimeFence: func(
			context.Context,
			WhatsappRuntimeFenceActivationRequest,
		) (WhatsappRuntimeFenceActivationResponse, error) {
			activationCalls++
			return WhatsappRuntimeFenceActivationResponse{}, nil
		},
		runtimeFenceRecoveryVerify: func(*whatsmeow.Client) bool {
			return true
		},
		runtimeFenceRecoveryRotate: func(
			context.Context,
			*whatsmeow.Client,
			string,
		) (whatsAppRuntimeFence, error) {
			recoveryRotationCalls++
			return whatsAppRuntimeFence{}, nil
		},
	}
	manager.mu.Lock()
	manager.degradedReason = "outbound_send_stalled"
	manager.mu.Unlock()
	manager.markProviderClientStalled(client)

	if _, err := manager.RequestConnection(
		context.Background(),
		StatusConnectionRequest{
			WorkerID: "worker-provider-reactivation-fence",
			Status:   WorkerStatusOnline,
			Type:     "qrcode",
		},
	); !errors.Is(err, errWhatsmeowProviderClientFenced) {
		t.Fatalf("RequestConnection did not require process restart: %v", err)
	}

	manager.handleEventFromClient(client, &events.Connected{})
	manager.Bootstrap(context.Background())
	if manager.publishConnectedIfAuthenticated(
		context.Background(),
		"quarantined-provider",
	) {
		t.Fatal("quarantined process published connected")
	}
	if _, err := manager.activateVerifiedInboundConnectionScope(
		context.Background(),
		client,
		"quarantined-provider",
	); !errors.Is(err, errWhatsmeowProviderClientFenced) {
		t.Fatalf("runtime activation did not require process restart: %v", err)
	}
	if _, err := manager.rotateRuntimeFenceRecoveryScope(
		context.Background(),
		client,
		"quarantined-provider",
	); !errors.Is(err, errWhatsmeowProviderClientFenced) {
		t.Fatalf("runtime recovery did not require process restart: %v", err)
	}
	lifecycle := manager.beginProviderLifecycleEvent(false)
	manager.scheduleRuntimeFenceRecovery(
		client,
		"quarantined-provider",
		lifecycle.serial,
	)
	manager.runtimeFenceRecoveryMu.Lock()
	recoveryScheduled := manager.runtimeFenceRecoveryCancel != nil
	manager.runtimeFenceRecoveryMu.Unlock()
	if recoveryScheduled {
		t.Fatal("quarantined process scheduled an in-place runtime recovery")
	}

	if activationCalls != 0 || recoveryRotationCalls != 0 {
		t.Fatalf(
			"quarantined process touched activation callbacks activation=%d recovery=%d",
			activationCalls,
			recoveryRotationCalls,
		)
	}
	if _, ok := manager.currentInboundConnectionScope(); ok {
		t.Fatal("quarantined process created a local runtime fence")
	}
	manager.mu.RLock()
	connected := manager.connected
	degradedReason := manager.degradedReason
	manager.mu.RUnlock()
	if connected || degradedReason != "outbound_send_stalled" {
		t.Fatalf(
			"quarantined process changed lifecycle connected=%t reason=%q",
			connected,
			degradedReason,
		)
	}
}

func TestProviderQuarantineLinearizesWithAdmissionMutex(t *testing.T) {
	client := &whatsmeow.Client{}
	quarantineReachedLock := make(chan struct{})
	quarantineCompleted := make(chan struct{})
	manager := &WhatsAppManager{
		providerQuarantineBeforeLock: func() {
			close(quarantineReachedLock)
		},
	}

	// Model an admission already inside its serialized critical section.
	// Quarantine must not become visible until it owns the same mutex; once it
	// does, every subsequent admission is rejected.
	manager.providerFlightMu.Lock()
	go func() {
		manager.markProviderClientStalled(client)
		close(quarantineCompleted)
	}()
	<-quarantineReachedLock
	if manager.isProviderProcessQuarantined() {
		manager.providerFlightMu.Unlock()
		t.Fatal("quarantine linearized before acquiring the admission mutex")
	}
	select {
	case <-quarantineCompleted:
		manager.providerFlightMu.Unlock()
		t.Fatal("quarantine bypassed the admission mutex")
	default:
	}
	manager.providerFlightMu.Unlock()

	select {
	case <-quarantineCompleted:
	case <-time.After(time.Second):
		t.Fatal("quarantine did not complete after admission released its mutex")
	}
	if !manager.isProviderProcessQuarantined() {
		t.Fatal("quarantine was not sticky after mutex linearization")
	}
	if _, err := manager.acquireProviderClientFlight(
		&whatsmeow.Client{},
		"post-quarantine-provider-call",
	); !errors.Is(err, errWhatsmeowProviderClientFenced) {
		t.Fatalf("post-quarantine admission was not rejected: %v", err)
	}
}
