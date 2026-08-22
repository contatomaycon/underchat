package whatsmeow

import (
	"context"
	"errors"
	"testing"

	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
)

var errTestCompanionReservationRejected = errors.New("test companion reservation rejected")

type rejectingCompanionContainer struct {
	reserveCalled bool
}

func (*rejectingCompanionContainer) PutDevice(context.Context, *store.Device) error {
	return nil
}

func (*rejectingCompanionContainer) DeleteDevice(context.Context, *store.Device) error {
	return nil
}

func (container *rejectingCompanionContainer) ReserveCompanionIdentity(context.Context, *store.Device) error {
	container.reserveCalled = true
	return errTestCompanionReservationRejected
}

func TestConnectReservesPairedCompanionBeforeOpeningSocket(t *testing.T) {
	container := &rejectingCompanionContainer{}
	jid := types.NewADJID("5511999999999", 0, 1)
	client := NewClient(&store.Device{ID: &jid, Container: container}, nil)

	err := client.ConnectContext(context.Background())
	if !errors.Is(err, errTestCompanionReservationRejected) {
		t.Fatalf("connect did not expose reservation rejection: %v", err)
	} else if !container.reserveCalled {
		t.Fatal("connect opened without checking companion reservation")
	} else if client.socket != nil {
		t.Fatal("connect created a websocket before companion reservation")
	}
}
