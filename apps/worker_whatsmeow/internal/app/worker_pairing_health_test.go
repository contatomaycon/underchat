package app

import "testing"

func TestApplyPairingRuntimeHealthKeepsPairingSeparateFromSessionReadiness(t *testing.T) {
	tests := []struct {
		name               string
		managerInitialized bool
		hasStoreID         bool
		qrStreamReady      bool
		wantHasSession     bool
	}{
		{
			name:               "active empty runtime can receive QR requests",
			managerInitialized: true,
			hasStoreID:         false,
			qrStreamReady:      true,
			wantHasSession:     false,
		},
		{
			name:               "persisted session remains distinct from QR stream",
			managerInitialized: true,
			hasStoreID:         true,
			qrStreamReady:      false,
			wantHasSession:     true,
		},
		{
			name:               "store evidence without a manager is not a usable session",
			managerInitialized: false,
			hasStoreID:         true,
			qrStreamReady:      false,
			wantHasSession:     false,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			health := map[string]any{
				"has_store_id":  test.hasStoreID,
				"ready":         false,
				"connected":     false,
				"session_ready": false,
			}

			applyPairingRuntimeHealth(
				health,
				test.managerInitialized,
				test.qrStreamReady,
			)

			if got := healthBool(health, "has_session"); got != test.wantHasSession {
				t.Fatalf("has_session = %t, want %t", got, test.wantHasSession)
			}
			if got := healthBool(health, "qr_stream_ready"); got != test.qrStreamReady {
				t.Fatalf("qr_stream_ready = %t, want %t", got, test.qrStreamReady)
			}
			for _, field := range []string{"ready", "connected", "session_ready"} {
				if healthBool(health, field) {
					t.Fatalf("%s changed while exposing pairing health", field)
				}
			}
		})
	}
}
