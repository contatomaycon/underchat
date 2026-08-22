package app

import (
	"context"
	"testing"

	"google.golang.org/protobuf/reflect/protoreflect"
)

func TestDynamicWorkerConnectionDescriptorIncludesRuntimeActivation(t *testing.T) {
	descs, err := getDescriptors()
	if err != nil {
		t.Fatalf("getDescriptors() error = %v", err)
	}

	if descs.workerConnectionService.Methods().ByName("ActivateRuntime") == nil {
		t.Fatal("ActivateRuntime method descriptor is missing")
	}
	if descs.workerConnectionService.Methods().ByName("RuntimeHealth") == nil {
		t.Fatal("RuntimeHealth method descriptor is missing")
	}
	if descs.workerRuntimeActivationRequest == nil {
		t.Fatal("WorkerRuntimeActivationRequest descriptor is missing")
	}
	if descs.workerRuntimeActivationResponse == nil {
		t.Fatal("WorkerRuntimeActivationResponse descriptor is missing")
	}
	if number := descs.workerRuntimeActivationResponse.Fields().ByName("activated").Number(); number != protoreflect.FieldNumber(3) {
		t.Fatalf("activated field number = %d, want 3", number)
	}
	if credentialsField := descs.workerRuntimeActivationRequest.Fields().ByName("nats_creds_base64"); credentialsField != nil {
		t.Fatalf("nats_creds_base64 field must not exist: %v", credentialsField)
	}
	if number := descs.workerRuntimeHealthResponse.Fields().ByName("ready").Number(); number != protoreflect.FieldNumber(6) {
		t.Fatalf("ready field number = %d, want 6", number)
	}
	if number := descs.workerRuntimeHealthResponse.Fields().ByName("qr_stream_ready").Number(); number != protoreflect.FieldNumber(13) {
		t.Fatalf("qr_stream_ready field number = %d, want 13", number)
	}
	if number := descs.workerRuntimeHealthResponse.Fields().ByName("kafka_unhealthy").Number(); number != protoreflect.FieldNumber(23) {
		t.Fatalf("kafka_unhealthy field number = %d, want 23", number)
	}
}

func TestWarmStandbyNATSAuthenticationPreservesStaticCredentials(t *testing.T) {
	local := warmStandbyNATSConfig(Config{
		AppEnvironment: "LOCAL",
		WarmStandby:    true,
		NATSUser:       "local-user",
		NATSPassword:   "local-password",
	})
	if local.NATSUser != "local-user" || local.NATSPassword != "local-password" {
		t.Fatalf("LOCAL warm authentication was not preserved: %+v", local)
	}

	productionInput := Config{
		AppEnvironment: "PROD",
		WarmStandby:    true,
		NATSUser:       "shared-user",
		NATSPassword:   "shared-password",
	}
	production := warmStandbyNATSConfig(productionInput)
	if !hasNATSAuthentication(production) || production.NATSUser != productionInput.NATSUser ||
		production.NATSPassword != productionInput.NATSPassword {
		t.Fatalf("PROD warm static authentication was not preserved: %+v", production)
	}
}

func TestWorkerRuntimeNATSConfigRequiresAndPreservesStaticCredentials(t *testing.T) {
	productionBase := Config{
		AppEnvironment: "PROD",
		NATSUser:       "shared-user",
		NATSPassword:   "shared-password",
	}
	production, err := workerRuntimeNATSConfig(productionBase)
	if err != nil {
		t.Fatalf("PROD static NATS credential error = %v", err)
	}
	if production.NATSUser != productionBase.NATSUser || production.NATSPassword != productionBase.NATSPassword {
		t.Fatalf("PROD static authentication changed during activation: %+v", production)
	}
	if _, err := workerRuntimeNATSConfig(Config{}); err == nil {
		t.Fatal("runtime activation accepted missing static NATS credentials")
	}
}

func TestRuntimeHealthReportsWarmStandbyReadyWithoutProviderRuntime(t *testing.T) {
	worker := &Worker{
		cfg: Config{
			WorkerID:    "warm-pool-1",
			AccountID:   "warm-standby",
			WarmStandby: true,
			WarmPoolID:  "warm-pool-1",
		},
	}

	resp, err := worker.RuntimeHealth(context.Background(), WorkerRuntimeHealthRequest{
		WarmPoolID: "warm-pool-1",
	})
	if err != nil {
		t.Fatalf("RuntimeHealth() error = %v", err)
	}
	if !resp.Ready || !resp.Standby || resp.Activated {
		t.Fatalf("RuntimeHealth() = %+v, want ready standby and not activated", resp)
	}
	if resp.WorkerTypeID != WorkerTypeWhatsmeow || resp.RuntimeState != "warm_standby" || resp.QRStreamReady {
		t.Fatalf("RuntimeHealth() = %+v, want whatsmeow warm standby without QR stream", resp)
	}
	if resp.HasSession || resp.HasQR || resp.SessionReady || resp.CanSend || resp.CanReceiveRuntime || resp.Authenticated {
		t.Fatalf("RuntimeHealth() = %+v, warm standby must not require provider/session readiness", resp)
	}
	if resp.KafkaConsumersReady || resp.KafkaConsumersAuthorized {
		t.Fatalf("RuntimeHealth() = %+v, warm standby must not start or authorize Kafka consumers", resp)
	}
	if resp.RuntimeHealthSchemaVersion != 4 {
		t.Fatalf("RuntimeHealth() schema version = %d, want 4", resp.RuntimeHealthSchemaVersion)
	}
}

func TestRuntimeHealthDoesNotReportUninitializedActiveWorkerReady(t *testing.T) {
	worker := &Worker{
		cfg: Config{
			WorkerID:  "worker-1",
			AccountID: "account-1",
		},
	}

	resp, err := worker.RuntimeHealth(context.Background(), WorkerRuntimeHealthRequest{})
	if err != nil {
		t.Fatalf("RuntimeHealth() error = %v", err)
	}
	if resp.Ready || resp.Standby || resp.Activated {
		t.Fatalf("RuntimeHealth() = %+v, want uninitialized active worker to remain not ready", resp)
	}
	if resp.RuntimeState != "inactive" || resp.QRStreamReady {
		t.Fatalf("RuntimeHealth() = %+v, want inactive runtime without QR stream", resp)
	}
}

func TestActivateRuntimeRejectsCapabilityMismatchWithoutLeavingStandby(t *testing.T) {
	worker := &Worker{
		cfg: Config{
			WarmStandby:       true,
			WarmPoolID:        "018f0000-0000-7000-8000-000000000001",
			SessionStorage:    SessionStoragePostgres,
			RuntimeCapability: "a-valid-preissued-capability-with-more-than-32-bytes",
			WriterEpoch:       "018f0000-0000-7000-8000-000000000002",
		},
	}

	resp, err := worker.ActivateRuntime(context.Background(), WorkerRuntimeActivationRequest{
		WorkerID:          "018f0000-0000-7000-8000-000000000003",
		AccountID:         "018f0000-0000-7000-8000-000000000004",
		WarmPoolID:        worker.cfg.WarmPoolID,
		RuntimeGeneration: 2,
		SessionStorage:    SessionStoragePostgres,
		RuntimeCapability: "a-different-capability-with-more-than-32-bytes-value",
		WriterEpoch:       worker.cfg.WriterEpoch,
	})
	if err == nil || resp.Activated {
		t.Fatalf("ActivateRuntime() = (%+v, %v), want rejected", resp, err)
	}
	if !worker.cfg.WarmStandby || worker.runtimeStarted || worker.cfg.WorkerID != "" || worker.cfg.AccountID != "" {
		t.Fatalf("worker mutated after rejected pre-fence activation: cfg=%+v started=%t", worker.cfg, worker.runtimeStarted)
	}
}
