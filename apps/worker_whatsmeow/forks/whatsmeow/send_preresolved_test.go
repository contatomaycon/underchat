package whatsmeow

import (
	"context"
	"errors"
	"testing"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
)

func TestValidatePreResolvedRecipientPNAcceptsVerifiedLIDPair(t *testing.T) {
	lid := types.NewJID("123456789012345", types.HiddenUserServer)
	pn := types.NewJID("5561995999040", types.DefaultUserServer)

	got, err := validatePreResolvedRecipientPN(lid, pn)
	if err != nil {
		t.Fatalf("validate pre-resolved pair: %v", err)
	}
	if got != pn {
		t.Fatalf("pre-resolved PN changed: want %s got %s", pn, got)
	}
}

func TestValidatePreResolvedRecipientPNPreservesLegacyEmptyOption(t *testing.T) {
	targets := []types.JID{
		types.NewJID("5561995999040", types.DefaultUserServer),
		types.NewJID("123456789012345", types.HiddenUserServer),
		types.NewJID("group", types.GroupServer),
	}
	for _, target := range targets {
		t.Run(target.String(), func(t *testing.T) {
			got, err := validatePreResolvedRecipientPN(target, types.EmptyJID)
			if err != nil {
				t.Fatalf("empty option changed legacy behavior: %v", err)
			}
			if !got.IsEmpty() {
				t.Fatalf("empty option returned %s", got)
			}
		})
	}
}

func TestValidatePreResolvedRecipientPNFailsClosed(t *testing.T) {
	validLID := types.NewJID("123456789012345", types.HiddenUserServer)
	validPN := types.NewJID("5561995999040", types.DefaultUserServer)
	tests := map[string]struct {
		to types.JID
		pn types.JID
	}{
		"PN destination": {
			to: validPN,
			pn: validPN,
		},
		"group destination": {
			to: types.NewJID("group", types.GroupServer),
			pn: validPN,
		},
		"empty LID user": {
			to: types.NewJID("", types.HiddenUserServer),
			pn: validPN,
		},
		"AD LID destination": {
			to: types.NewADJID(validLID.User, types.LIDDomain, 7),
			pn: validPN,
		},
		"integrator LID destination": {
			to: types.JID{
				User:       validLID.User,
				Server:     validLID.Server,
				Integrator: 1,
			},
			pn: validPN,
		},
		"non-PN identity": {
			to: validLID,
			pn: types.NewJID(validPN.User, types.HiddenUserServer),
		},
		"empty PN user": {
			to: validLID,
			pn: types.NewJID("", types.DefaultUserServer),
		},
		"non-numeric PN": {
			to: validLID,
			pn: types.NewJID("+55-invalid", types.DefaultUserServer),
		},
		"AD PN": {
			to: validLID,
			pn: types.NewADJID(validPN.User, types.WhatsAppDomain, 4),
		},
		"integrator PN": {
			to: validLID,
			pn: types.JID{
				User:       validPN.User,
				Server:     validPN.Server,
				Integrator: 1,
			},
		},
	}
	for name, test := range tests {
		t.Run(name, func(t *testing.T) {
			_, err := validatePreResolvedRecipientPN(test.to, test.pn)
			if !errors.Is(err, ErrInvalidPreResolvedRecipientPN) {
				t.Fatalf("expected ErrInvalidPreResolvedRecipientPN, got %v", err)
			}
		})
	}
}

func TestPreResolvedRecipientPNPreservesBotIdentity(t *testing.T) {
	lid := types.NewJID("123456789012345", types.HiddenUserServer)
	regularPN := types.NewJID("5561995999040", types.DefaultUserServer)
	botPN := types.MetaAIJID

	if usesBotRecipientIdentity(lid, regularPN) {
		t.Fatal("regular PN was classified as a bot")
	}
	if !usesBotRecipientIdentity(lid, botPN) {
		t.Fatal("pre-resolved bot PN identity was lost")
	}
	if !usesBotRecipientIdentity(types.NewJID("867051314767696", types.BotServer), types.EmptyJID) {
		t.Fatal("legacy bot destination was not classified as a bot")
	}
}

func TestResolvePeerRecipientPNForLIDSkipsReverseStoreWhenPreResolved(t *testing.T) {
	lid := types.NewJID("123456789012345", types.HiddenUserServer)
	preResolvedPN := types.NewJID("5561995999040", types.DefaultUserServer)
	legacyPN := types.NewJID("5511999999999", types.DefaultUserServer)
	lidStore := &countingLIDStore{pn: legacyPN}
	client := &Client{Store: &store.Device{LIDs: lidStore}}

	got, err := client.resolvePeerRecipientPNForLID(context.Background(), lid, preResolvedPN)
	if err != nil {
		t.Fatalf("resolve pre-resolved PN: %v", err)
	}
	if got != preResolvedPN {
		t.Fatalf("pre-resolved PN changed: want %s got %s", preResolvedPN, got)
	}
	if lidStore.reverseCalls != 0 {
		t.Fatalf("pre-resolved PN unexpectedly read reverse store %d times", lidStore.reverseCalls)
	}

	got, err = client.resolvePeerRecipientPNForLID(context.Background(), lid, types.EmptyJID)
	if err != nil {
		t.Fatalf("resolve legacy PN: %v", err)
	}
	if got != legacyPN {
		t.Fatalf("legacy reverse mapping changed: want %s got %s", legacyPN, got)
	}
	if lidStore.reverseCalls != 1 {
		t.Fatalf("legacy path must read reverse store once, got %d", lidStore.reverseCalls)
	}
}

func TestSendMessageRejectsInvalidPreResolvedRecipientPNBeforeLogin(t *testing.T) {
	client := &Client{}
	_, err := client.SendMessage(
		context.Background(),
		types.NewJID("5561995999040", types.DefaultUserServer),
		&waE2E.Message{},
		SendRequestExtra{
			PreResolvedRecipientPN: types.NewJID("5561995999040", types.DefaultUserServer),
		},
	)
	if !errors.Is(err, ErrInvalidPreResolvedRecipientPN) {
		t.Fatalf("expected fail-closed pre-resolved validation, got %v", err)
	}
}

type countingLIDStore struct {
	store.LIDStore
	pn           types.JID
	reverseCalls int
}

func (s *countingLIDStore) GetPNForLID(context.Context, types.JID) (types.JID, error) {
	s.reverseCalls++
	return s.pn, nil
}
