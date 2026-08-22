// Copyright (c) 2026 Tulir Asokan
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

package store

import (
	"fmt"

	"go.mau.fi/libsignal/groups/ratchet"
	grouprecord "go.mau.fi/libsignal/groups/state/record"
	"go.mau.fi/libsignal/keys/chain"
	"go.mau.fi/libsignal/keys/message"
	"go.mau.fi/libsignal/protocol"
	"go.mau.fi/libsignal/serialize"
	signalrecord "go.mau.fi/libsignal/state/record"
	"go.mau.fi/libsignal/util/optional"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
)

// CanonicalSignalStorageCodec is the Signal LocalStorageProtocol wire format
// shared with WhatsApp Web and Baileys handoff codecs. The upstream
// NewProtoBufSerializer still assigns JSON serializers to records and states;
// these adapters replace only the durable storage serializers while retaining
// its protobuf message serializers.
const CanonicalSignalStorageCodec = "signal-local-storage-protobuf-v1"

const (
	CanonicalSignalSessionMaxBytes  = 8 * 1024 * 1024
	CanonicalSenderKeyMaxBytes      = 2 * 1024 * 1024
	canonicalPreviousStatesMax      = 40
	canonicalReceiverChainsMax      = 5
	canonicalSenderKeyStatesMax     = 5
	canonicalMessageKeysPerChainMax = 2000
)

type canonicalSessionSerializer struct {
	legacy serialize.JSONSessionSerializer
}

type canonicalStateSerializer struct {
	legacy serialize.JSONStateSerializer
}

type canonicalSenderKeySerializer struct {
	legacy serialize.JSONSenderKeySessionSerializer
}

type canonicalSenderKeyStateSerializer struct {
	legacy serialize.JSONSenderKeyStateSerializer
}

// NewCanonicalSignalSerializer returns a serializer that always writes
// LocalStorageProtocol protobuf for durable Signal records and can read both
// canonical protobuf and legacy WhatsMeow JSON. A successfully read legacy
// record is rewritten as protobuf the next time it is stored.
func NewCanonicalSignalSerializer() *serialize.Serializer {
	serializer := serialize.NewProtoBufSerializer()
	serializer.Session = &canonicalSessionSerializer{}
	serializer.State = &canonicalStateSerializer{}
	serializer.SenderKeyRecord = &canonicalSenderKeySerializer{}
	serializer.SenderKeyState = &canonicalSenderKeyStateSerializer{}
	return serializer
}

func (s *canonicalSessionSerializer) Serialize(value *signalrecord.SessionStructure) []byte {
	encoded, err := proto.Marshal(sessionRecordToProto(value))
	if err != nil {
		return nil
	}
	return encoded
}

func (s *canonicalSessionSerializer) Deserialize(encoded []byte) (*signalrecord.SessionStructure, error) {
	if len(encoded) == 0 || len(encoded) > CanonicalSignalSessionMaxBytes {
		return nil, fmt.Errorf("Signal session storage payload size is invalid")
	}
	var canonical serialize.RecordStructure
	canonicalErr := proto.Unmarshal(encoded, &canonical)
	if canonicalErr == nil {
		canonicalErr = rejectUnknownProtoFields(canonical.ProtoReflect())
	}
	if canonicalErr == nil && canonical.CurrentSession != nil {
		decoded, err := sessionRecordFromProto(&canonical)
		if err == nil {
			err = validateSessionRecordStructure(decoded)
		}
		if err == nil {
			return decoded, nil
		}
		canonicalErr = err
	} else if canonicalErr == nil {
		canonicalErr = fmt.Errorf("canonical Signal record has no current session")
	}
	legacy, legacyErr := s.legacy.Deserialize(encoded)
	if legacyErr == nil {
		legacyErr = validateSessionRecordStructure(legacy)
	}
	if legacyErr == nil {
		return legacy, nil
	}
	return nil, fmt.Errorf("decode canonical Signal session: %v; decode legacy Signal session: %w", canonicalErr, legacyErr)
}

func (s *canonicalStateSerializer) Serialize(value *signalrecord.StateStructure) []byte {
	encoded, err := proto.Marshal(sessionStateToProto(value))
	if err != nil {
		return nil
	}
	return encoded
}

func (s *canonicalStateSerializer) Deserialize(encoded []byte) (*signalrecord.StateStructure, error) {
	if len(encoded) == 0 || len(encoded) > CanonicalSignalSessionMaxBytes {
		return nil, fmt.Errorf("Signal state storage payload size is invalid")
	}
	var canonical serialize.SessionStructure
	canonicalErr := proto.Unmarshal(encoded, &canonical)
	if canonicalErr == nil {
		canonicalErr = rejectUnknownProtoFields(canonical.ProtoReflect())
	}
	if canonicalErr == nil && canonical.SessionVersion != nil {
		decoded, err := sessionStateFromProto(&canonical)
		if err == nil {
			_, err = validateSessionStateStructure(decoded)
		}
		if err == nil {
			return decoded, nil
		}
		canonicalErr = err
	} else if canonicalErr == nil {
		canonicalErr = fmt.Errorf("canonical Signal state has no version")
	}
	legacy, legacyErr := s.legacy.Deserialize(encoded)
	if legacyErr == nil {
		_, legacyErr = validateSessionStateStructure(legacy)
	}
	if legacyErr == nil {
		return legacy, nil
	}
	return nil, fmt.Errorf("decode canonical Signal state: %v; decode legacy Signal state: %w", canonicalErr, legacyErr)
}

func (s *canonicalSenderKeySerializer) Serialize(value *grouprecord.SenderKeyStructure) []byte {
	encoded, err := proto.Marshal(senderKeyRecordToProto(value))
	if err != nil {
		return nil
	}
	return encoded
}

func (s *canonicalSenderKeySerializer) Deserialize(encoded []byte) (*grouprecord.SenderKeyStructure, error) {
	if len(encoded) == 0 || len(encoded) > CanonicalSenderKeyMaxBytes {
		return nil, fmt.Errorf("sender-key storage payload size is invalid")
	}
	var canonical serialize.SenderKeyRecordStructure
	canonicalErr := proto.Unmarshal(encoded, &canonical)
	if canonicalErr == nil {
		canonicalErr = rejectUnknownProtoFields(canonical.ProtoReflect())
	}
	if canonicalErr == nil && len(canonical.SenderKeyStates) > 0 {
		decoded, err := senderKeyRecordFromProto(&canonical)
		if err == nil {
			err = validateSenderKeyRecordStructure(decoded)
		}
		if err == nil {
			return decoded, nil
		}
		canonicalErr = err
	} else if canonicalErr == nil {
		canonicalErr = fmt.Errorf("canonical sender-key record has no states")
	}
	legacy, legacyErr := s.legacy.Deserialize(encoded)
	if legacyErr == nil {
		legacyErr = validateSenderKeyRecordStructure(legacy)
	}
	if legacyErr == nil {
		return legacy, nil
	}
	return nil, fmt.Errorf("decode canonical sender-key record: %v; decode legacy sender-key record: %w", canonicalErr, legacyErr)
}

func (s *canonicalSenderKeyStateSerializer) Serialize(value *grouprecord.SenderKeyStateStructure) []byte {
	encoded, err := proto.Marshal(senderKeyStateToProto(value))
	if err != nil {
		return nil
	}
	return encoded
}

func (s *canonicalSenderKeyStateSerializer) Deserialize(encoded []byte) (*grouprecord.SenderKeyStateStructure, error) {
	if len(encoded) == 0 || len(encoded) > CanonicalSenderKeyMaxBytes {
		return nil, fmt.Errorf("sender-key state storage payload size is invalid")
	}
	var canonical serialize.SenderKeyStateStructure
	canonicalErr := proto.Unmarshal(encoded, &canonical)
	if canonicalErr == nil {
		canonicalErr = rejectUnknownProtoFields(canonical.ProtoReflect())
	}
	if canonicalErr == nil && canonical.SenderChainKey != nil && canonical.SenderSigningKey != nil {
		decoded, err := senderKeyStateFromProto(&canonical)
		if err == nil {
			err = validateSenderKeyStateStructure(decoded)
		}
		if err == nil {
			return decoded, nil
		}
		canonicalErr = err
	} else if canonicalErr == nil {
		canonicalErr = fmt.Errorf("canonical sender-key state is incomplete")
	}
	legacy, legacyErr := s.legacy.Deserialize(encoded)
	if legacyErr == nil {
		legacyErr = validateSenderKeyStateStructure(legacy)
	}
	if legacyErr == nil {
		return legacy, nil
	}
	return nil, fmt.Errorf("decode canonical sender-key state: %v; decode legacy sender-key state: %w", canonicalErr, legacyErr)
}

// NormalizeSignalSessionStorage validates either supported storage format and
// returns deterministic canonical protobuf without exposing decoded key data.
func NormalizeSignalSessionStorage(encoded []byte) ([]byte, error) {
	record, err := signalrecord.NewSessionFromBytes(
		encoded,
		SignalProtobufSerializer.Session,
		SignalProtobufSerializer.State,
	)
	if err != nil {
		return nil, err
	}
	canonical := record.Serialize()
	if len(canonical) == 0 {
		return nil, fmt.Errorf("canonical Signal session serialization failed")
	}
	return canonical, nil
}

// NormalizeSenderKeyStorage validates either supported storage format and
// returns deterministic canonical protobuf without exposing decoded key data.
func NormalizeSenderKeyStorage(encoded []byte) ([]byte, error) {
	record, err := grouprecord.NewSenderKeyFromBytes(
		encoded,
		SignalProtobufSerializer.SenderKeyRecord,
		SignalProtobufSerializer.SenderKeyState,
	)
	if err != nil {
		return nil, err
	}
	canonical := record.Serialize()
	if len(canonical) == 0 {
		return nil, fmt.Errorf("canonical sender-key serialization failed")
	}
	return canonical, nil
}

func sessionRecordToProto(value *signalrecord.SessionStructure) *serialize.RecordStructure {
	if value == nil {
		return &serialize.RecordStructure{}
	}
	previous := make([]*serialize.SessionStructure, 0, len(value.PreviousStates))
	for _, state := range value.PreviousStates {
		previous = append(previous, sessionStateToProto(state))
	}
	return &serialize.RecordStructure{
		CurrentSession:   sessionStateToProto(value.SessionState),
		PreviousSessions: previous,
	}
}

func sessionRecordFromProto(value *serialize.RecordStructure) (*signalrecord.SessionStructure, error) {
	current, err := sessionStateFromProto(value.CurrentSession)
	if err != nil {
		return nil, err
	}
	previous := make([]*signalrecord.StateStructure, 0, len(value.PreviousSessions))
	for _, state := range value.PreviousSessions {
		decoded, decodeErr := sessionStateFromProto(state)
		if decodeErr != nil {
			return nil, decodeErr
		}
		previous = append(previous, decoded)
	}
	return &signalrecord.SessionStructure{SessionState: current, PreviousStates: previous}, nil
}

func sessionStateToProto(value *signalrecord.StateStructure) *serialize.SessionStructure {
	if value == nil {
		return nil
	}
	version := uint32(value.SessionVersion)
	previousCounter := value.PreviousCounter
	remoteRegistrationID := value.RemoteRegistrationID
	localRegistrationID := value.LocalRegistrationID
	needsRefresh := value.NeedsRefresh
	receivers := make([]*serialize.SessionStructure_Chain, 0, len(value.ReceiverChains))
	for _, receiver := range value.ReceiverChains {
		receivers = append(receivers, sessionChainToProto(receiver))
	}
	return &serialize.SessionStructure{
		SessionVersion:       &version,
		LocalIdentityPublic:  value.LocalIdentityPublic,
		RemoteIdentityPublic: value.RemoteIdentityPublic,
		RootKey:              value.RootKey,
		PreviousCounter:      &previousCounter,
		SenderChain:          sessionChainToProto(value.SenderChain),
		ReceiverChains:       receivers,
		PendingKeyExchange:   pendingKeyExchangeToProto(value.PendingKeyExchange),
		PendingPreKey:        pendingPreKeyToProto(value.PendingPreKey),
		RemoteRegistrationId: &remoteRegistrationID,
		LocalRegistrationId:  &localRegistrationID,
		NeedsRefresh:         &needsRefresh,
		AliceBaseKey:         value.SenderBaseKey,
	}
}

func sessionStateFromProto(value *serialize.SessionStructure) (*signalrecord.StateStructure, error) {
	if value == nil || value.SessionVersion == nil {
		return nil, fmt.Errorf("canonical Signal state is incomplete")
	}
	if value.GetSessionVersion() != protocol.CurrentVersion {
		return nil, fmt.Errorf("canonical Signal session version is unsupported")
	}
	senderChain, err := sessionChainFromProto(value.SenderChain)
	if err != nil {
		return nil, err
	}
	receivers := make([]*signalrecord.ChainStructure, 0, len(value.ReceiverChains))
	for _, receiver := range value.ReceiverChains {
		decoded, decodeErr := sessionChainFromProto(receiver)
		if decodeErr != nil {
			return nil, decodeErr
		}
		receivers = append(receivers, decoded)
	}
	pendingPreKey, err := pendingPreKeyFromProto(value.PendingPreKey)
	if err != nil {
		return nil, err
	}
	return &signalrecord.StateStructure{
		LocalIdentityPublic:  value.LocalIdentityPublic,
		LocalRegistrationID:  value.GetLocalRegistrationId(),
		NeedsRefresh:         value.GetNeedsRefresh(),
		PendingKeyExchange:   pendingKeyExchangeFromProto(value.PendingKeyExchange),
		PendingPreKey:        pendingPreKey,
		PreviousCounter:      value.GetPreviousCounter(),
		ReceiverChains:       receivers,
		RemoteIdentityPublic: value.RemoteIdentityPublic,
		RemoteRegistrationID: value.GetRemoteRegistrationId(),
		RootKey:              value.RootKey,
		SenderBaseKey:        value.AliceBaseKey,
		SenderChain:          senderChain,
		SessionVersion:       int(value.GetSessionVersion()),
	}, nil
}

func sessionChainToProto(value *signalrecord.ChainStructure) *serialize.SessionStructure_Chain {
	if value == nil {
		return nil
	}
	var chainKey *serialize.SessionStructure_Chain_ChainKey
	if value.ChainKey != nil {
		index := value.ChainKey.Index
		chainKey = &serialize.SessionStructure_Chain_ChainKey{Index: &index, Key: value.ChainKey.Key}
	}
	messages := make([]*serialize.SessionStructure_Chain_MessageKey, 0, len(value.MessageKeys))
	for _, key := range value.MessageKeys {
		if key == nil {
			continue
		}
		index := key.Index
		messages = append(messages, &serialize.SessionStructure_Chain_MessageKey{
			Index: &index, CipherKey: key.CipherKey, MacKey: key.MacKey, Iv: key.IV,
		})
	}
	return &serialize.SessionStructure_Chain{
		SenderRatchetKey:        value.SenderRatchetKeyPublic,
		SenderRatchetKeyPrivate: value.SenderRatchetKeyPrivate,
		ChainKey:                chainKey,
		MessageKeys:             messages,
	}
}

func sessionChainFromProto(value *serialize.SessionStructure_Chain) (*signalrecord.ChainStructure, error) {
	if value == nil || value.ChainKey == nil {
		return nil, fmt.Errorf("canonical Signal chain is incomplete")
	}
	messages := make([]*message.KeysStructure, 0, len(value.MessageKeys))
	for _, key := range value.MessageKeys {
		if key == nil {
			return nil, fmt.Errorf("canonical Signal message key is missing")
		}
		messages = append(messages, &message.KeysStructure{
			Index: key.GetIndex(), CipherKey: key.CipherKey, MacKey: key.MacKey, IV: key.Iv,
		})
	}
	return &signalrecord.ChainStructure{
		SenderRatchetKeyPublic:  value.SenderRatchetKey,
		SenderRatchetKeyPrivate: value.SenderRatchetKeyPrivate,
		ChainKey: &chain.KeyStructure{
			Index: value.ChainKey.GetIndex(), Key: value.ChainKey.Key,
		},
		MessageKeys: messages,
	}, nil
}

func pendingKeyExchangeToProto(value *signalrecord.PendingKeyExchangeStructure) *serialize.SessionStructure_PendingKeyExchange {
	if value == nil {
		return nil
	}
	sequence := value.Sequence
	return &serialize.SessionStructure_PendingKeyExchange{
		Sequence:                &sequence,
		LocalBaseKey:            value.LocalBaseKeyPublic,
		LocalBaseKeyPrivate:     value.LocalBaseKeyPrivate,
		LocalRatchetKey:         value.LocalRatchetKeyPublic,
		LocalRatchetKeyPrivate:  value.LocalRatchetKeyPrivate,
		LocalIdentityKey:        value.LocalIdentityKeyPublic,
		LocalIdentityKeyPrivate: value.LocalIdentityKeyPrivate,
	}
}

func pendingKeyExchangeFromProto(value *serialize.SessionStructure_PendingKeyExchange) *signalrecord.PendingKeyExchangeStructure {
	if value == nil {
		return nil
	}
	return &signalrecord.PendingKeyExchangeStructure{
		Sequence:                value.GetSequence(),
		LocalBaseKeyPublic:      value.LocalBaseKey,
		LocalBaseKeyPrivate:     value.LocalBaseKeyPrivate,
		LocalRatchetKeyPublic:   value.LocalRatchetKey,
		LocalRatchetKeyPrivate:  value.LocalRatchetKeyPrivate,
		LocalIdentityKeyPublic:  value.LocalIdentityKey,
		LocalIdentityKeyPrivate: value.LocalIdentityKeyPrivate,
	}
}

func pendingPreKeyToProto(value *signalrecord.PendingPreKeyStructure) *serialize.SessionStructure_PendingPreKey {
	if value == nil {
		return nil
	}
	signedPreKeyID := int32(value.SignedPreKeyID)
	result := &serialize.SessionStructure_PendingPreKey{
		SignedPreKeyId: &signedPreKeyID,
		BaseKey:        value.BaseKey,
	}
	if value.PreKeyID != nil && !value.PreKeyID.IsEmpty {
		preKeyID := value.PreKeyID.Value
		result.PreKeyId = &preKeyID
	}
	return result
}

func pendingPreKeyFromProto(value *serialize.SessionStructure_PendingPreKey) (*signalrecord.PendingPreKeyStructure, error) {
	if value == nil {
		return nil, nil
	}
	if value.GetSignedPreKeyId() < 0 {
		return nil, fmt.Errorf("canonical signed pre-key ID is negative")
	}
	preKeyID := optional.NewEmptyUint32()
	if value.PreKeyId != nil {
		preKeyID = optional.NewOptionalUint32(value.GetPreKeyId())
	}
	return &signalrecord.PendingPreKeyStructure{
		PreKeyID: preKeyID, SignedPreKeyID: uint32(value.GetSignedPreKeyId()), BaseKey: value.BaseKey,
	}, nil
}

func senderKeyRecordToProto(value *grouprecord.SenderKeyStructure) *serialize.SenderKeyRecordStructure {
	if value == nil {
		return &serialize.SenderKeyRecordStructure{}
	}
	states := make([]*serialize.SenderKeyStateStructure, 0, len(value.SenderKeyStates))
	for _, state := range value.SenderKeyStates {
		states = append(states, senderKeyStateToProto(state))
	}
	return &serialize.SenderKeyRecordStructure{SenderKeyStates: states}
}

func senderKeyRecordFromProto(value *serialize.SenderKeyRecordStructure) (*grouprecord.SenderKeyStructure, error) {
	states := make([]*grouprecord.SenderKeyStateStructure, 0, len(value.SenderKeyStates))
	for _, state := range value.SenderKeyStates {
		decoded, err := senderKeyStateFromProto(state)
		if err != nil {
			return nil, err
		}
		states = append(states, decoded)
	}
	return &grouprecord.SenderKeyStructure{SenderKeyStates: states}, nil
}

func senderKeyStateToProto(value *grouprecord.SenderKeyStateStructure) *serialize.SenderKeyStateStructure {
	if value == nil {
		return nil
	}
	keyID := value.KeyID
	var chainKey *serialize.SenderKeyStateStructure_SenderChainKey
	if value.SenderChainKey != nil {
		iteration := value.SenderChainKey.Iteration
		chainKey = &serialize.SenderKeyStateStructure_SenderChainKey{
			Iteration: &iteration, Seed: value.SenderChainKey.ChainKey,
		}
	}
	messages := make([]*serialize.SenderKeyStateStructure_SenderMessageKey, 0, len(value.Keys))
	for _, key := range value.Keys {
		if key == nil {
			continue
		}
		iteration := key.Iteration
		messages = append(messages, &serialize.SenderKeyStateStructure_SenderMessageKey{
			Iteration: &iteration, Seed: key.Seed,
		})
	}
	return &serialize.SenderKeyStateStructure{
		SenderKeyId:       &keyID,
		SenderChainKey:    chainKey,
		SenderSigningKey:  &serialize.SenderKeyStateStructure_SenderSigningKey{Public: value.SigningKeyPublic, Private: value.SigningKeyPrivate},
		SenderMessageKeys: messages,
	}
}

func senderKeyStateFromProto(value *serialize.SenderKeyStateStructure) (*grouprecord.SenderKeyStateStructure, error) {
	if value == nil || value.SenderChainKey == nil || value.SenderSigningKey == nil {
		return nil, fmt.Errorf("canonical sender-key state is incomplete")
	}
	messages := make([]*ratchet.SenderMessageKeyStructure, 0, len(value.SenderMessageKeys))
	for _, key := range value.SenderMessageKeys {
		if key == nil {
			return nil, fmt.Errorf("canonical sender message key is missing")
		}
		derived, err := ratchet.NewSenderMessageKey(key.GetIteration(), key.Seed)
		if err != nil {
			return nil, fmt.Errorf("derive canonical sender message key: %w", err)
		}
		messages = append(messages, ratchet.NewStructFromSenderMessageKey(derived))
	}
	return &grouprecord.SenderKeyStateStructure{
		Keys:  messages,
		KeyID: value.GetSenderKeyId(),
		SenderChainKey: &ratchet.SenderChainKeyStructure{
			Iteration: value.SenderChainKey.GetIteration(), ChainKey: value.SenderChainKey.Seed,
		},
		SigningKeyPublic:  value.SenderSigningKey.Public,
		SigningKeyPrivate: value.SenderSigningKey.Private,
	}, nil
}

func rejectUnknownProtoFields(message protoreflect.Message) error {
	if len(message.GetUnknown()) > 0 {
		return fmt.Errorf("canonical Signal protobuf contains unknown fields")
	}
	var nestedErr error
	message.Range(func(field protoreflect.FieldDescriptor, value protoreflect.Value) bool {
		if field.Kind() != protoreflect.MessageKind && field.Kind() != protoreflect.GroupKind {
			return true
		}
		if field.IsList() {
			list := value.List()
			for index := 0; index < list.Len(); index++ {
				if err := rejectUnknownProtoFields(list.Get(index).Message()); err != nil {
					nestedErr = err
					return false
				}
			}
			return true
		}
		nestedErr = rejectUnknownProtoFields(value.Message())
		return nestedErr == nil
	})
	return nestedErr
}

func validateSessionRecordStructure(value *signalrecord.SessionStructure) error {
	if value == nil || value.SessionState == nil {
		return fmt.Errorf("Signal session record is incomplete")
	}
	if len(value.PreviousStates) > canonicalPreviousStatesMax {
		return fmt.Errorf("Signal session has too many previous states")
	}
	messageKeyCount, err := validateSessionStateStructure(value.SessionState)
	if err != nil {
		return err
	}
	for _, previous := range value.PreviousStates {
		count, err := validateSessionStateStructure(previous)
		if err != nil {
			return err
		}
		messageKeyCount += count
	}
	if messageKeyCount > canonicalMessageKeysPerChainMax {
		return fmt.Errorf("Signal session record has too many skipped message keys")
	}
	return nil
}

func validateSessionStateStructure(value *signalrecord.StateStructure) (int, error) {
	if value == nil || value.SessionVersion != protocol.CurrentVersion {
		return 0, fmt.Errorf("Signal session version is unsupported")
	}
	for name, field := range map[string][]byte{
		"local identity public key":  value.LocalIdentityPublic,
		"remote identity public key": value.RemoteIdentityPublic,
		"sender base key":            value.SenderBaseKey,
	} {
		if err := requireStorageLength(name, field, 33); err != nil {
			return 0, err
		}
	}
	if err := requireStorageLength("root key", value.RootKey, 32); err != nil {
		return 0, err
	}
	messageKeyCount, err := validateSessionChainStructure(value.SenderChain)
	if err != nil {
		return 0, fmt.Errorf("sender chain: %w", err)
	}
	if len(value.ReceiverChains) > canonicalReceiverChainsMax {
		return 0, fmt.Errorf("Signal session has too many receiver chains")
	}
	for _, receiver := range value.ReceiverChains {
		count, err := validateSessionChainStructure(receiver)
		if err != nil {
			return 0, fmt.Errorf("receiver chain: %w", err)
		}
		messageKeyCount += count
	}
	if pending := value.PendingKeyExchange; pending != nil {
		for name, field := range map[string][]byte{
			"pending local base public key":      pending.LocalBaseKeyPublic,
			"pending local base private key":     pending.LocalBaseKeyPrivate,
			"pending local ratchet public key":   pending.LocalRatchetKeyPublic,
			"pending local ratchet private key":  pending.LocalRatchetKeyPrivate,
			"pending local identity public key":  pending.LocalIdentityKeyPublic,
			"pending local identity private key": pending.LocalIdentityKeyPrivate,
		} {
			if err := requireStorageLength(name, field, 32); err != nil {
				return 0, err
			}
		}
	}
	if pending := value.PendingPreKey; pending != nil {
		if pending.PreKeyID == nil {
			return 0, fmt.Errorf("pending pre-key optional ID is missing")
		}
		if err := requireStorageLength("pending pre-key base key", pending.BaseKey, 33); err != nil {
			return 0, err
		}
	}
	if messageKeyCount > canonicalMessageKeysPerChainMax {
		return 0, fmt.Errorf("Signal session state has too many skipped message keys")
	}
	return messageKeyCount, nil
}

func validateSessionChainStructure(value *signalrecord.ChainStructure) (int, error) {
	if value == nil || value.ChainKey == nil {
		return 0, fmt.Errorf("Signal chain is incomplete")
	}
	if err := requireStorageLength("ratchet public key", value.SenderRatchetKeyPublic, 33); err != nil {
		return 0, err
	}
	if length := len(value.SenderRatchetKeyPrivate); length != 0 && length != 32 {
		return 0, fmt.Errorf("ratchet private key length is invalid")
	}
	if err := requireStorageLength("chain key", value.ChainKey.Key, 32); err != nil {
		return 0, err
	}
	if len(value.MessageKeys) > canonicalMessageKeysPerChainMax {
		return 0, fmt.Errorf("Signal chain has too many skipped message keys")
	}
	for _, key := range value.MessageKeys {
		if key == nil {
			return 0, fmt.Errorf("Signal message key is missing")
		}
		for name, field := range map[string][]byte{
			"message cipher key": key.CipherKey,
			"message MAC key":    key.MacKey,
		} {
			if err := requireStorageLength(name, field, 32); err != nil {
				return 0, err
			}
		}
		if err := requireStorageLength("message IV", key.IV, 16); err != nil {
			return 0, err
		}
	}
	return len(value.MessageKeys), nil
}

func validateSenderKeyRecordStructure(value *grouprecord.SenderKeyStructure) error {
	if value == nil || len(value.SenderKeyStates) == 0 {
		return fmt.Errorf("sender-key record is incomplete")
	}
	if len(value.SenderKeyStates) > canonicalSenderKeyStatesMax {
		return fmt.Errorf("sender-key record has too many states")
	}
	for _, state := range value.SenderKeyStates {
		if err := validateSenderKeyStateStructure(state); err != nil {
			return err
		}
	}
	return nil
}

func validateSenderKeyStateStructure(value *grouprecord.SenderKeyStateStructure) error {
	if value == nil || value.SenderChainKey == nil {
		return fmt.Errorf("sender-key state is incomplete")
	}
	if err := requireStorageLength("sender chain seed", value.SenderChainKey.ChainKey, 32); err != nil {
		return err
	}
	if err := requireStorageLength("sender signing public key", value.SigningKeyPublic, 33); err != nil {
		return err
	}
	if length := len(value.SigningKeyPrivate); length != 0 && length != 32 {
		return fmt.Errorf("sender signing private key length is invalid")
	}
	if len(value.Keys) > canonicalMessageKeysPerChainMax {
		return fmt.Errorf("sender-key state has too many message keys")
	}
	for _, key := range value.Keys {
		if key == nil {
			return fmt.Errorf("sender message key is missing")
		}
		if err := requireStorageLength("sender message seed", key.Seed, 32); err != nil {
			return err
		}
		if err := requireStorageLength("sender message cipher key", key.CipherKey, 32); err != nil {
			return err
		}
		if err := requireStorageLength("sender message IV", key.IV, 16); err != nil {
			return err
		}
	}
	return nil
}

func requireStorageLength(name string, value []byte, expected int) error {
	if len(value) != expected {
		return fmt.Errorf("%s length is invalid", name)
	}
	return nil
}
