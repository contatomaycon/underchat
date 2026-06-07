package app

import "testing"

func TestConnectionQRCodeRequestComplete(t *testing.T) {
	tests := []struct {
		name  string
		state ConnectionState
		want  bool
	}{
		{
			name: "pending without qr is not complete",
			state: ConnectionState{
				Status:    "connecting",
				Code:      CodeAwaitingReadQRCode,
				QRPending: true,
			},
			want: false,
		},
		{
			name: "initial without qr is not complete",
			state: ConnectionState{
				Status: "initial",
				Code:   CodeAwaitConnection,
			},
			want: false,
		},
		{
			name: "info without qr is not complete",
			state: ConnectionState{
				Status: "info",
				Code:   CodeInfo,
			},
			want: false,
		},
		{
			name: "qr is complete",
			state: ConnectionState{
				Status: "connecting",
				Code:   CodeAwaitingReadQRCode,
				QRCode: "data:image/png;base64,qr",
			},
			want: true,
		},
		{
			name: "pairing code is complete",
			state: ConnectionState{
				Status:      "connecting",
				Code:        CodeAwaitingPairingCode,
				PairingCode: "12345678",
			},
			want: true,
		},
		{
			name: "connected is complete",
			state: ConnectionState{
				Status: "connected",
				Code:   CodeConnectionEstablished,
			},
			want: true,
		},
		{
			name: "terminal disconnected without pending is complete",
			state: ConnectionState{
				Status: "disconnected",
				Code:   CodeConnectionClosed,
			},
			want: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := connectionQRCodeRequestComplete(tt.state); got != tt.want {
				t.Fatalf("connectionQRCodeRequestComplete() = %t, want %t", got, tt.want)
			}
		})
	}
}
