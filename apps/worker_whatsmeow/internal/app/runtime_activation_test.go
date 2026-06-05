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
	if number := descs.workerRuntimeHealthResponse.Fields().ByName("ready").Number(); number != protoreflect.FieldNumber(6) {
		t.Fatalf("ready field number = %d, want 6", number)
	}
}

func TestRuntimeHealthReportsWarmStandbyReady(t *testing.T) {
	worker := &Worker{
		cfg: Config{
			WorkerID:    "warm-pool-1",
			AccountID:   "warm-standby",
			WarmStandby: true,
			WarmPoolID:  "warm-pool-1",
		},
		whatsapp: &WhatsAppManager{},
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
}
