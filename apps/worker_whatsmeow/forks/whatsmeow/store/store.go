// Copyright (c) 2025 Tulir Asokan
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Package store contains interfaces for storing data needed for WhatsApp multidevice.
package store

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"

	"go.mau.fi/whatsmeow/proto/waAdv"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/util/keys"
	waLog "go.mau.fi/whatsmeow/util/log"
)

type IdentityStore interface {
	PutIdentity(ctx context.Context, address string, key [32]byte) error
	DeleteAllIdentities(ctx context.Context, phone string) error
	DeleteIdentity(ctx context.Context, address string) error
	IsTrustedIdentity(ctx context.Context, address string, key [32]byte) (bool, error)
}

type SessionStore interface {
	GetSession(ctx context.Context, address string) ([]byte, error)
	HasSession(ctx context.Context, address string) (bool, error)
	GetManySessions(ctx context.Context, addresses []string) (map[string][]byte, error)
	PutSession(ctx context.Context, address string, session []byte) error
	PutManySessions(ctx context.Context, sessions map[string][]byte) error
	DeleteAllSessions(ctx context.Context, phone string) error
	DeleteSession(ctx context.Context, address string) error
	MigratePNToLID(ctx context.Context, pn, lid types.JID) error
}

type PreKeyStore interface {
	GetOrGenPreKeys(ctx context.Context, count uint32) ([]*keys.PreKey, error)
	GenOnePreKey(ctx context.Context) (*keys.PreKey, error)
	GetPreKey(ctx context.Context, id uint32) (*keys.PreKey, error)
	RemovePreKey(ctx context.Context, id uint32) error
	MarkPreKeysAsUploaded(ctx context.Context, upToID uint32) error
	UploadedPreKeyCount(ctx context.Context) (int, error)
}

type SenderKeyStore interface {
	PutSenderKey(ctx context.Context, group, user string, session []byte) error
	GetSenderKey(ctx context.Context, group, user string) ([]byte, error)
}

type AppStateSyncKey struct {
	Data        []byte
	Fingerprint []byte
	Timestamp   int64
}

type AppStateSyncKeyStore interface {
	PutAppStateSyncKey(ctx context.Context, id []byte, key AppStateSyncKey) error
	GetAppStateSyncKey(ctx context.Context, id []byte) (*AppStateSyncKey, error)
	GetLatestAppStateSyncKeyID(ctx context.Context) ([]byte, error)
	GetAllAppStateSyncKeys(ctx context.Context) ([]*AppStateSyncKey, error)
}

type AppStateMutationMAC struct {
	IndexMAC []byte
	ValueMAC []byte
}

type AppStateStore interface {
	PutAppStateVersion(ctx context.Context, name string, version uint64, hash [128]byte) error
	GetAppStateVersion(ctx context.Context, name string) (uint64, [128]byte, error)
	DeleteAppStateVersion(ctx context.Context, name string) error

	PutAppStateMutationMACs(ctx context.Context, name string, version uint64, mutations []AppStateMutationMAC) error
	DeleteAppStateMutationMACs(ctx context.Context, name string, indexMACs [][]byte) error
	GetAppStateMutationMAC(ctx context.Context, name string, indexMAC []byte) (valueMAC []byte, err error)
}

type ContactEntry struct {
	JID       types.JID
	FirstName string
	FullName  string
}

func (ce ContactEntry) GetMassInsertValues() [3]any {
	return [...]any{ce.JID.String(), ce.FirstName, ce.FullName}
}

type RedactedPhoneEntry struct {
	JID           types.JID
	RedactedPhone string
}

func (rpe RedactedPhoneEntry) GetMassInsertValues() [2]any {
	return [...]any{rpe.JID.String(), rpe.RedactedPhone}
}

type ContactStore interface {
	PutPushName(ctx context.Context, user types.JID, pushName string) (bool, string, error)
	PutBusinessName(ctx context.Context, user types.JID, businessName string) (bool, string, error)
	PutContactName(ctx context.Context, user types.JID, fullName, firstName string) error
	PutAllContactNames(ctx context.Context, contacts []ContactEntry) error
	PutManyRedactedPhones(ctx context.Context, entries []RedactedPhoneEntry) error
	GetContact(ctx context.Context, user types.JID) (types.ContactInfo, error)
	GetAllContacts(ctx context.Context) (map[types.JID]types.ContactInfo, error)
}

var MutedForever = time.Date(9999, 12, 31, 23, 59, 59, 999999999, time.UTC)

type ChatSettingsStore interface {
	PutMutedUntil(ctx context.Context, chat types.JID, mutedUntil time.Time) error
	PutPinned(ctx context.Context, chat types.JID, pinned bool) error
	PutArchived(ctx context.Context, chat types.JID, archived bool) error
	GetChatSettings(ctx context.Context, chat types.JID) (types.LocalChatSettings, error)
}

type DeviceContainer interface {
	PutDevice(ctx context.Context, store *Device) error
	DeleteDevice(ctx context.Context, store *Device) error
}

const (
	// WhatsAppTransportNamespace and WhatsAppTransportRoutingInfoKey identify
	// the provider-neutral edge-routing record shared by all native providers.
	// The payload is intentionally opaque: decoding and re-encoding it could
	// discard fields introduced by a newer WhatsApp transport.
	WhatsAppTransportNamespace          = "whatsapp/transport"
	WhatsAppTransportRoutingInfoKey     = "routing_info"
	WhatsAppTransportCodecVersion       = 1
	MaxWhatsAppTransportRoutingInfoSize = 65535
)

var ErrInvalidWhatsAppTransportRoutingInfo = errors.New("whatsapp transport routing info is invalid")

// ValidateWhatsAppTransportRoutingInfo enforces the portable transport
// contract without inspecting or exposing the opaque payload.
func ValidateWhatsAppTransportRoutingInfo(routingInfo []byte) error {
	if len(routingInfo) == 0 || len(routingInfo) > MaxWhatsAppTransportRoutingInfoSize {
		return ErrInvalidWhatsAppTransportRoutingInfo
	}
	return nil
}

// TransportStore persists provider-neutral transport state for one exact
// session revision. It is optional for custom stores, while SQLStore implements
// it natively with the same lease/RLS guards as protocol state.
type TransportStore interface {
	PutTransportRoutingInfo(ctx context.Context, routingInfo []byte) error
	GetTransportRoutingInfo(ctx context.Context) ([]byte, error)
	DeleteTransportRoutingInfo(ctx context.Context) error
}

// CompanionIdentityReserver is implemented by persistent stores that can
// atomically reserve a paired companion identity before the client opens a
// network socket. It is deliberately optional so custom in-memory stores keep
// implementing DeviceContainer without a source-incompatible API change.
type CompanionIdentityReserver interface {
	ReserveCompanionIdentity(ctx context.Context, device *Device) error
}

// ConnectionStatusFence is the non-secret identity of the PostgreSQL lease
// generation that owns a live transport. Required is false for stores that do
// not use shared-database fencing (for example a standalone SQLite store).
// Capability is intentionally absent because connection status must never
// expose or retain the runtime secret.
type ConnectionStatusFence struct {
	Required     bool
	OwnerID      string
	FencingToken int64
	Generation   int64
	Epoch        string
}

// ConnectionStatusFenceProvider exposes the current in-memory fencing
// snapshot for an exact session revision. Implementations must not perform a
// database or network call. Clients use it to ensure a cached online state can
// never survive lease loss or a transport-generation takeover.
type ConnectionStatusFenceProvider interface {
	CurrentConnectionStatusFence(sessionID string, revisionID int64) (ConnectionStatusFence, error)
}

type MessageSecretInsert struct {
	Chat   types.JID
	Sender types.JID
	ID     types.MessageID
	Secret []byte
}

type MsgSecretStore interface {
	PutMessageSecrets(ctx context.Context, inserts []MessageSecretInsert) error
	PutMessageSecret(ctx context.Context, chat, sender types.JID, id types.MessageID, secret []byte) error
	GetMessageSecret(ctx context.Context, chat, sender types.JID, id types.MessageID) ([]byte, types.JID, error)
}

type PrivacyToken struct {
	User            types.JID
	Token           []byte
	Timestamp       time.Time
	SenderTimestamp time.Time
}

type PrivacyTokenStore interface {
	PutPrivacyTokens(ctx context.Context, tokens ...PrivacyToken) error
	GetPrivacyToken(ctx context.Context, user types.JID) (*PrivacyToken, error)
	DeleteExpiredPrivacyTokens(ctx context.Context, cutoff time.Time) (int64, error)
}

type NCTSaltStore interface {
	PutNCTSalt(ctx context.Context, salt []byte) error
	GetNCTSalt(ctx context.Context) ([]byte, error)
	DeleteNCTSalt(ctx context.Context) error
}

type BufferedEvent struct {
	Plaintext  []byte
	InsertTime time.Time
	ServerTime time.Time
}

type EventBuffer interface {
	GetBufferedEvent(ctx context.Context, ciphertextHash [32]byte) (*BufferedEvent, error)
	PutBufferedEvent(ctx context.Context, ciphertextHash [32]byte, plaintext []byte, serverTimestamp time.Time) error
	DoDecryptionTxn(ctx context.Context, fn func(context.Context) error) error
	ClearBufferedEventPlaintext(ctx context.Context, ciphertextHash [32]byte) error
	DeleteOldBufferedHashes(ctx context.Context) error

	GetOutgoingEvent(ctx context.Context, chatJID, altChatJID types.JID, id types.MessageID) (string, []byte, error)
	AddOutgoingEvent(ctx context.Context, chatJID types.JID, id types.MessageID, format string, plaintext []byte) error
	DeleteOldOutgoingEvents(ctx context.Context) error
}

type LIDMapping struct {
	LID types.JID
	PN  types.JID
}

func (lm LIDMapping) GetMassInsertValues() [2]any {
	return [...]any{lm.LID.User, lm.PN.User}
}

type LIDStore interface {
	PutManyLIDMappings(ctx context.Context, mappings []LIDMapping) error
	PutLIDMapping(ctx context.Context, lid, jid types.JID) error
	GetPNForLID(ctx context.Context, lid types.JID) (types.JID, error)
	GetLIDForPN(ctx context.Context, pn types.JID) (types.JID, error)
	GetManyLIDsForPNs(ctx context.Context, pns []types.JID) (map[types.JID]types.JID, error)
}

type AllSessionSpecificStores interface {
	IdentityStore
	SessionStore
	PreKeyStore
	SenderKeyStore
	AppStateSyncKeyStore
	AppStateStore
	ContactStore
	ChatSettingsStore
	MsgSecretStore
	PrivacyTokenStore
	NCTSaltStore
	EventBuffer
}

type AllGlobalStores interface {
	LIDStore
}

type AllStores interface {
	AllSessionSpecificStores
	AllGlobalStores
}

type CacheInvalidator interface {
	InvalidateCaches()
}

type Device struct {
	Log waLog.Logger
	// SessionID is the stable channel identifier that owns this device in a
	// shared SQL store. It must not be derived from the WhatsApp JID.
	SessionID string
	// RevisionID identifies the immutable provider projection used by this
	// device. Together with SessionID it is the ownership boundary for every
	// row and cache in shared SQL stores.
	RevisionID int64

	NoiseKey       *keys.KeyPair
	IdentityKey    *keys.KeyPair
	SignedPreKey   *keys.PreKey
	RegistrationID uint32
	AdvSecretKey   []byte
	// AdvSecretAvailable distinguishes a real 32-byte ADV secret from a
	// provider projection that only owns the signed public identity.
	AdvSecretAvailable bool

	ID  *types.JID
	LID types.JID

	Account      *waAdv.ADVSignedDeviceIdentity
	Platform     string
	BusinessName string
	PushName     string

	LIDMigrationTimestamp int64

	FacebookUUID uuid.UUID
	// DeviceFingerprint is the canonical SHA-256 identity of the paired
	// companion. It is safe for equality checks but must not be used as a
	// session ownership key.
	DeviceFingerprint  [32]byte
	FingerprintVersion string
	// NextPreKeyID mirrors the persisted allocator for diagnostics. Allocation
	// itself is always an atomic database operation and never trusts this value.
	NextPreKeyID uint32

	Initialized   bool
	Deleted       bool
	Identities    IdentityStore
	Sessions      SessionStore
	PreKeys       PreKeyStore
	SenderKeys    SenderKeyStore
	AppStateKeys  AppStateSyncKeyStore
	AppState      AppStateStore
	Contacts      ContactStore
	ChatSettings  ChatSettingsStore
	MsgSecrets    MsgSecretStore
	PrivacyTokens PrivacyTokenStore
	NCTSalt       NCTSaltStore
	EventBuffer   EventBuffer
	Transport     TransportStore
	LIDs          LIDStore
	Container     DeviceContainer
}

func (device *Device) GetJID() types.JID {
	if device == nil {
		return types.EmptyJID
	}
	id := device.ID
	if id == nil {
		return types.EmptyJID
	}
	return *id
}

func (device *Device) GetLID() types.JID {
	if device == nil {
		return types.EmptyJID
	}
	return device.LID
}

var ErrDeviceDeleted = errors.New("invalid use of deleted device")

func (device *Device) Save(ctx context.Context) error {
	if device.Deleted {
		return ErrDeviceDeleted
	}
	return device.Container.PutDevice(ctx, device)
}

func (device *Device) Delete(ctx context.Context) error {
	if device.Deleted {
		return nil
	}
	err := device.Container.DeleteDevice(ctx, device)
	if err != nil {
		return err
	}
	device.InvalidateCaches()
	device.ID = nil
	device.LID = types.EmptyJID
	device.Deleted = true
	device.SetAllStores(&NoopStore{ErrDeviceDeleted})
	return nil
}

// InvalidateCaches clears all provider-store caches for this session revision.
// Lease-loss and handoff paths must call it before disconnecting or reusing a
// Device. Implementations must not retain JID/LID/contact data afterward.
func (device *Device) InvalidateCaches() {
	if invalidator, ok := device.Identities.(CacheInvalidator); ok {
		invalidator.InvalidateCaches()
		return
	}
	if invalidator, ok := device.LIDs.(CacheInvalidator); ok {
		invalidator.InvalidateCaches()
	}
}

func (device *Device) SetAllStores(store AllSessionSpecificStores) {
	device.Identities = store
	device.Sessions = store
	device.PreKeys = store
	device.SenderKeys = store
	device.AppStateKeys = store
	device.AppState = store
	device.Contacts = store
	device.ChatSettings = store
	device.MsgSecrets = store
	device.PrivacyTokens = store
	device.NCTSalt = store
	device.EventBuffer = store
	if transport, ok := store.(TransportStore); ok {
		device.Transport = transport
	} else {
		device.Transport = nil
	}
}

func (device *Device) GetAltJID(ctx context.Context, jid types.JID) (types.JID, error) {
	if device == nil {
		return types.EmptyJID, nil
	} else if jid.Server == types.DefaultUserServer {
		return device.LIDs.GetLIDForPN(ctx, jid)
	} else if jid.Server == types.HiddenUserServer {
		return device.LIDs.GetPNForLID(ctx, jid)
	} else {
		return types.EmptyJID, nil
	}
}
