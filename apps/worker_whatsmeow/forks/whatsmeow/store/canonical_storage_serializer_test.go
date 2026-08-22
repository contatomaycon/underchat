package store

import (
	"bytes"
	"testing"

	"go.mau.fi/libsignal/ecc"
	"go.mau.fi/libsignal/groups/ratchet"
	grouprecord "go.mau.fi/libsignal/groups/state/record"
	"go.mau.fi/libsignal/keys/chain"
	"go.mau.fi/libsignal/keys/message"
	"go.mau.fi/libsignal/serialize"
	signalrecord "go.mau.fi/libsignal/state/record"
	"google.golang.org/protobuf/proto"
)

func canonicalSessionFixture(t *testing.T) *signalrecord.SessionStructure {
	t.Helper()
	localIdentity, err := ecc.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}
	remoteIdentity, err := ecc.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}
	senderBase, err := ecc.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}
	ratchetKey, err := ecc.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}
	state := &signalrecord.StateStructure{
		LocalIdentityPublic:  localIdentity.PublicKey().Serialize(),
		LocalRegistrationID:  7,
		RemoteIdentityPublic: remoteIdentity.PublicKey().Serialize(),
		RemoteRegistrationID: 9,
		RootKey:              bytes.Repeat([]byte{1}, 32),
		SenderBaseKey:        senderBase.PublicKey().Serialize(),
		SenderChain: &signalrecord.ChainStructure{
			SenderRatchetKeyPublic:  ratchetKey.PublicKey().Serialize(),
			SenderRatchetKeyPrivate: privateKeyBytes(ratchetKey),
			ChainKey: &chain.KeyStructure{
				Index: 11,
				Key:   bytes.Repeat([]byte{2}, 32),
			},
		},
		SessionVersion: 3,
	}
	return &signalrecord.SessionStructure{SessionState: state}
}

func canonicalSenderKeyFixture(t *testing.T) *grouprecord.SenderKeyStructure {
	t.Helper()
	signingKey, err := ecc.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}
	messageKey, err := ratchet.NewSenderMessageKey(3, bytes.Repeat([]byte{4}, 32))
	if err != nil {
		t.Fatal(err)
	}
	return &grouprecord.SenderKeyStructure{SenderKeyStates: []*grouprecord.SenderKeyStateStructure{{
		Keys:  []*ratchet.SenderMessageKeyStructure{ratchet.NewStructFromSenderMessageKey(messageKey)},
		KeyID: 42,
		SenderChainKey: &ratchet.SenderChainKeyStructure{
			Iteration: 5,
			ChainKey:  bytes.Repeat([]byte{3}, 32),
		},
		SigningKeyPublic:  signingKey.PublicKey().Serialize(),
		SigningKeyPrivate: privateKeyBytes(signingKey),
	}}}
}

func privateKeyBytes(keyPair *ecc.ECKeyPair) []byte {
	privateKey := keyPair.PrivateKey().Serialize()
	return privateKey[:]
}

func TestCanonicalSessionStorageReadsLegacyJSONAndAlwaysWritesProtobuf(t *testing.T) {
	fixture := canonicalSessionFixture(t)
	legacy := (&serialize.JSONSessionSerializer{}).Serialize(fixture)
	canonical, err := NormalizeSignalSessionStorage(legacy)
	if err != nil {
		t.Fatalf("normalize legacy Signal session: %v", err)
	}
	var wire serialize.RecordStructure
	if err = proto.Unmarshal(canonical, &wire); err != nil || wire.CurrentSession == nil {
		t.Fatalf("normalized Signal session is not canonical protobuf: %v", err)
	}
	if _, err = signalrecord.NewSessionFromBytes(
		canonical,
		SignalProtobufSerializer.Session,
		SignalProtobufSerializer.State,
	); err != nil {
		t.Fatalf("runtime rejected canonical Signal session: %v", err)
	}
	second, err := NormalizeSignalSessionStorage(canonical)
	if err != nil || !bytes.Equal(second, canonical) {
		t.Fatalf("canonical Signal storage is not stable: equal=%t err=%v", bytes.Equal(second, canonical), err)
	}
}

func TestCanonicalSenderKeyStorageReadsLegacyJSONAndAlwaysWritesProtobuf(t *testing.T) {
	fixture := canonicalSenderKeyFixture(t)
	legacy := (&serialize.JSONSenderKeySessionSerializer{}).Serialize(fixture)
	canonical, err := NormalizeSenderKeyStorage(legacy)
	if err != nil {
		t.Fatalf("normalize legacy sender key: %v", err)
	}
	var wire serialize.SenderKeyRecordStructure
	if err = proto.Unmarshal(canonical, &wire); err != nil || len(wire.SenderKeyStates) != 1 {
		t.Fatalf("normalized sender key is not canonical protobuf: %v", err)
	}
	if _, err = grouprecord.NewSenderKeyFromBytes(
		canonical,
		SignalProtobufSerializer.SenderKeyRecord,
		SignalProtobufSerializer.SenderKeyState,
	); err != nil {
		t.Fatalf("runtime rejected canonical sender key: %v", err)
	}
	second, err := NormalizeSenderKeyStorage(canonical)
	if err != nil || !bytes.Equal(second, canonical) {
		t.Fatalf("canonical sender-key storage is not stable: equal=%t err=%v", bytes.Equal(second, canonical), err)
	}
}

func TestCanonicalSessionStorageRejectsCorruptOversizedAndUnboundedRecords(t *testing.T) {
	if _, err := NormalizeSignalSessionStorage(make([]byte, CanonicalSignalSessionMaxBytes+1)); err == nil {
		t.Fatal("oversized Signal session was accepted")
	}
	if _, err := NormalizeSignalSessionStorage([]byte{0xff, 0xff}); err == nil {
		t.Fatal("corrupt Signal session was accepted")
	}

	tests := map[string]func(*signalrecord.SessionStructure){
		"unsupported version": func(record *signalrecord.SessionStructure) {
			record.SessionState.SessionVersion = 2
		},
		"invalid identity length": func(record *signalrecord.SessionStructure) {
			record.SessionState.LocalIdentityPublic = make([]byte, 32)
		},
		"too many previous states": func(record *signalrecord.SessionStructure) {
			record.PreviousStates = make([]*signalrecord.StateStructure, canonicalPreviousStatesMax+1)
			for index := range record.PreviousStates {
				record.PreviousStates[index] = record.SessionState
			}
		},
		"too many receiver chains": func(record *signalrecord.SessionStructure) {
			record.SessionState.ReceiverChains = make([]*signalrecord.ChainStructure, canonicalReceiverChainsMax+1)
			for index := range record.SessionState.ReceiverChains {
				record.SessionState.ReceiverChains[index] = record.SessionState.SenderChain
			}
		},
		"too many skipped keys": func(record *signalrecord.SessionStructure) {
			record.SessionState.SenderChain.MessageKeys = make([]*message.KeysStructure, canonicalMessageKeysPerChainMax+1)
			for index := range record.SessionState.SenderChain.MessageKeys {
				record.SessionState.SenderChain.MessageKeys[index] = &message.KeysStructure{
					Index:     uint32(index),
					CipherKey: make([]byte, 32),
					MacKey:    make([]byte, 32),
					IV:        make([]byte, 16),
				}
			}
		},
		"too many skipped keys aggregated": func(record *signalrecord.SessionStructure) {
			record.SessionState.SenderChain.MessageKeys = make([]*message.KeysStructure, canonicalMessageKeysPerChainMax/2+1)
			for index := range record.SessionState.SenderChain.MessageKeys {
				record.SessionState.SenderChain.MessageKeys[index] = &message.KeysStructure{
					Index:     uint32(index),
					CipherKey: make([]byte, 32),
					MacKey:    make([]byte, 32),
					IV:        make([]byte, 16),
				}
			}
			record.PreviousStates = []*signalrecord.StateStructure{record.SessionState}
		},
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			fixture := canonicalSessionFixture(t)
			mutate(fixture)
			encoded := SignalProtobufSerializer.Session.Serialize(fixture)
			if _, err := NormalizeSignalSessionStorage(encoded); err == nil {
				t.Fatalf("invalid Signal session %q was accepted", name)
			}
		})
	}
}

func TestCanonicalSenderKeyStorageRejectsCorruptOversizedAndUnboundedRecords(t *testing.T) {
	if _, err := NormalizeSenderKeyStorage(make([]byte, CanonicalSenderKeyMaxBytes+1)); err == nil {
		t.Fatal("oversized sender-key record was accepted")
	}
	if _, err := NormalizeSenderKeyStorage([]byte{0xff, 0xff}); err == nil {
		t.Fatal("corrupt sender-key record was accepted")
	}

	t.Run("too many states", func(t *testing.T) {
		fixture := canonicalSenderKeyFixture(t)
		fixture.SenderKeyStates = make([]*grouprecord.SenderKeyStateStructure, canonicalSenderKeyStatesMax+1)
		for index := range fixture.SenderKeyStates {
			fixture.SenderKeyStates[index] = canonicalSenderKeyFixture(t).SenderKeyStates[0]
		}
		if _, err := NormalizeSenderKeyStorage(SignalProtobufSerializer.SenderKeyRecord.Serialize(fixture)); err == nil {
			t.Fatal("sender-key state limit was not enforced")
		}
	})

	t.Run("too many message keys", func(t *testing.T) {
		fixture := canonicalSenderKeyFixture(t)
		state := fixture.SenderKeyStates[0]
		state.Keys = make([]*ratchet.SenderMessageKeyStructure, canonicalMessageKeysPerChainMax+1)
		for index := range state.Keys {
			state.Keys[index] = &ratchet.SenderMessageKeyStructure{
				Iteration: uint32(index), Seed: make([]byte, 32), CipherKey: make([]byte, 32), IV: make([]byte, 16),
			}
		}
		if _, err := NormalizeSenderKeyStorage(SignalProtobufSerializer.SenderKeyRecord.Serialize(fixture)); err == nil {
			t.Fatal("sender message-key limit was not enforced")
		}
	})

	t.Run("invalid signing key", func(t *testing.T) {
		fixture := canonicalSenderKeyFixture(t)
		fixture.SenderKeyStates[0].SigningKeyPublic = make([]byte, 32)
		if _, err := NormalizeSenderKeyStorage(SignalProtobufSerializer.SenderKeyRecord.Serialize(fixture)); err == nil {
			t.Fatal("invalid sender signing key was accepted")
		}
	})
}
