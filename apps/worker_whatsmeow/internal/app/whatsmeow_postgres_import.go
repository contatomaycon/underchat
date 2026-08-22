package app

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/google/uuid"

	"go.mau.fi/whatsmeow/proto/waAdv"
	meowstore "go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/util/keys"
)

const (
	whatsmeowImportBatchSize       = 250
	whatsmeowProjectionMaxRows     = 200_000
	whatsmeowProjectionMaxBytes    = 64 * 1024 * 1024
	whatsmeowProjectionRowOverhead = 16
	whatsmeowWWebMetadataMaxBytes  = 64 * 1024
)

const (
	whatsmeowWWebCanonicalMetaNamespace = "_wwebjs_canonical"
	whatsmeowWWebCanonicalMetaKey       = "v1"
	whatsmeowWWebCanonicalCodecKind     = "wwebjs-canonical-session-v1"
	whatsmeowWWebCanonicalModuleABI     = "wwebjs-private-modules-v1"
	whatsmeowWWebLifecycleNamespace     = "_wwebjs_lifecycle"
	whatsmeowWWebPQRollbackMarkerKey    = "pq_server_rollback_v1"
	whatsmeowBaileysHandoffNamespace    = "_baileys_handoff"
	whatsmeowPQRollbackProtocol         = "delete_pq_prekeys_server_ack_v1"
	whatsmeowPQUploadLifecycleFenceV1   = 1
)

type whatsmeowColumnKind string

const (
	whatsmeowText  whatsmeowColumnKind = "text"
	whatsmeowBytes whatsmeowColumnKind = "bytes"
	whatsmeowInt   whatsmeowColumnKind = "int"
	whatsmeowBool  whatsmeowColumnKind = "bool"
)

// Name identifies the same generic projection in the external SQLite artifact
// and PostgreSQL. Source ownership columns are never copied: the authenticated
// destination scope always injects both ownership keys.
type whatsmeowTableDescriptor struct {
	Name    string
	Columns []string
	Kinds   []whatsmeowColumnKind
}

// Ordered by the generic schema's foreign-key dependencies.
var whatsmeowScopedTables = []whatsmeowTableDescriptor{
	{
		Name:    "whatsapp_device",
		Columns: []string{"jid", "lid", "facebook_uuid", "registration_id", "noise_key", "identity_key", "signed_pre_key", "signed_pre_key_id", "signed_pre_key_sig", "adv_key", "adv_secret_available", "adv_details", "adv_account_sig", "adv_account_sig_key", "adv_device_sig", "platform", "business_name", "push_name", "lid_migration_ts"},
		Kinds:   []whatsmeowColumnKind{whatsmeowText, whatsmeowText, whatsmeowText, whatsmeowInt, whatsmeowBytes, whatsmeowBytes, whatsmeowBytes, whatsmeowInt, whatsmeowBytes, whatsmeowBytes, whatsmeowBool, whatsmeowBytes, whatsmeowBytes, whatsmeowBytes, whatsmeowBytes, whatsmeowText, whatsmeowText, whatsmeowText, whatsmeowInt},
	},
	{Name: "whatsapp_identity_keys", Columns: []string{"their_id", "identity"}, Kinds: []whatsmeowColumnKind{whatsmeowText, whatsmeowBytes}},
	{Name: "whatsapp_pre_keys", Columns: []string{"key_id", "key", "uploaded"}, Kinds: []whatsmeowColumnKind{whatsmeowInt, whatsmeowBytes, whatsmeowBool}},
	{Name: "whatsapp_signal_sessions", Columns: []string{"their_id", "scope", "session"}, Kinds: []whatsmeowColumnKind{whatsmeowText, whatsmeowText, whatsmeowBytes}},
	{Name: "whatsapp_sender_keys", Columns: []string{"chat_id", "sender_id", "sender_key"}, Kinds: []whatsmeowColumnKind{whatsmeowText, whatsmeowText, whatsmeowBytes}},
	{Name: "whatsapp_app_state_sync_keys", Columns: []string{"key_id", "key_data", "timestamp", "fingerprint"}, Kinds: []whatsmeowColumnKind{whatsmeowBytes, whatsmeowBytes, whatsmeowInt, whatsmeowBytes}},
	{Name: "whatsapp_app_state_version", Columns: []string{"name", "version", "hash"}, Kinds: []whatsmeowColumnKind{whatsmeowText, whatsmeowInt, whatsmeowBytes}},
	{Name: "whatsapp_app_state_mutation_macs", Columns: []string{"name", "version", "index_mac", "value_mac"}, Kinds: []whatsmeowColumnKind{whatsmeowText, whatsmeowInt, whatsmeowBytes, whatsmeowBytes}},
	{Name: "whatsapp_contacts", Columns: []string{"their_jid", "first_name", "full_name", "push_name", "business_name", "redacted_phone"}, Kinds: []whatsmeowColumnKind{whatsmeowText, whatsmeowText, whatsmeowText, whatsmeowText, whatsmeowText, whatsmeowText}},
	{Name: "whatsapp_chat_settings", Columns: []string{"chat_jid", "muted_until", "pinned", "archived"}, Kinds: []whatsmeowColumnKind{whatsmeowText, whatsmeowInt, whatsmeowBool, whatsmeowBool}},
	{Name: "whatsapp_message_secrets", Columns: []string{"chat_jid", "sender_jid", "message_id", "key"}, Kinds: []whatsmeowColumnKind{whatsmeowText, whatsmeowText, whatsmeowText, whatsmeowBytes}},
	{Name: "whatsapp_privacy_tokens", Columns: []string{"their_jid", "token", "timestamp", "sender_timestamp"}, Kinds: []whatsmeowColumnKind{whatsmeowText, whatsmeowBytes, whatsmeowInt, whatsmeowInt}},
	{Name: "whatsapp_nct_salt", Columns: []string{"salt"}, Kinds: []whatsmeowColumnKind{whatsmeowBytes}},
	{Name: "whatsapp_lid_map", Columns: []string{"lid", "pn"}, Kinds: []whatsmeowColumnKind{whatsmeowText, whatsmeowText}},
	{Name: "whatsapp_event_buffer", Columns: []string{"ciphertext_hash", "plaintext", "server_timestamp", "insert_timestamp"}, Kinds: []whatsmeowColumnKind{whatsmeowBytes, whatsmeowBytes, whatsmeowInt, whatsmeowInt}},
	{Name: "whatsapp_retry_buffer", Columns: []string{"chat_jid", "message_id", "format", "plaintext", "timestamp"}, Kinds: []whatsmeowColumnKind{whatsmeowText, whatsmeowText, whatsmeowText, whatsmeowBytes, whatsmeowInt}},
}

var whatsmeowTransportTable = whatsmeowTableDescriptor{
	Name:    "whatsapp_provider_record",
	Columns: []string{"namespace", "record_key", "codec_version", "payload"},
	Kinds:   []whatsmeowColumnKind{whatsmeowText, whatsmeowText, whatsmeowInt, whatsmeowBytes},
}

func whatsmeowPortableTables() []whatsmeowTableDescriptor {
	tables := make([]whatsmeowTableDescriptor, 0, len(whatsmeowScopedTables)+1)
	tables = append(tables, whatsmeowScopedTables...)
	return append(tables, whatsmeowTransportTable)
}

// Stable primary-key order makes projection checksums repeatable across
// PostgreSQL plans and SQLite page layouts.
var whatsmeowSnapshotOrderColumns = map[string][]string{
	"whatsapp_identity_keys":           {"their_id"},
	"whatsapp_pre_keys":                {"key_id"},
	"whatsapp_signal_sessions":         {"their_id", "scope"},
	"whatsapp_sender_keys":             {"chat_id", "sender_id"},
	"whatsapp_app_state_sync_keys":     {"key_id"},
	"whatsapp_app_state_version":       {"name"},
	"whatsapp_app_state_mutation_macs": {"name", "index_mac", "version"},
	"whatsapp_contacts":                {"their_jid"},
	"whatsapp_chat_settings":           {"chat_jid"},
	"whatsapp_message_secrets":         {"chat_jid", "sender_jid", "message_id"},
	"whatsapp_privacy_tokens":          {"their_jid"},
	"whatsapp_lid_map":                 {"lid"},
	"whatsapp_event_buffer":            {"ciphertext_hash"},
	"whatsapp_retry_buffer":            {"chat_jid", "message_id"},
	"whatsapp_provider_record":         {"namespace", "record_key"},
}

type whatsmeowBackupCell struct {
	Kind  string
	Text  string
	Bytes []byte
	Int   int64
	Bool  bool
}

type whatsmeowBackupTable struct {
	Name string
	Rows [][]whatsmeowBackupCell
}

type whatsmeowSessionSnapshot struct {
	Version              int
	JID                  string
	SourceRevisionOrigin string
	DeviceFingerprint    []byte
	FingerprintVersion   string
	NextPreKeyID         int64
	Tables               []whatsmeowBackupTable
}

type whatsmeowPreparedTable struct {
	Name    string
	Columns []string
	Rows    [][]any
}

type whatsmeowImportStage struct {
	CandidateRevision                 int64
	PreviousRevision                  int64
	HandoffID                         string
	ExpectedJID                       string
	AppStateSnapshotResyncRequired    bool
	AppStateSnapshotResyncPending     bool
	AppStateSnapshotResyncArtifactID  string
	AppStateSnapshotResyncCollections []string
}

type whatsmeowHandoffSourceScope struct {
	SourceProvider       string
	SourceRevision       int64
	TargetProvider       string
	TargetRevision       int64
	HandoffID            string
	LifecycleOperationID string
}

type whatsmeowPQRollbackMarker struct {
	Version                 int    `json:"version"`
	State                   string `json:"state"`
	HandoffID               string `json:"handoff_id"`
	LifecycleOperationID    string `json:"lifecycle_operation_id"`
	SourceRevisionID        string `json:"source_revision_id"`
	TargetProvider          string `json:"target_provider"`
	OwnerID                 string `json:"owner_id"`
	FencingToken            string `json:"fencing_token"`
	Generation              int    `json:"generation"`
	Epoch                   string `json:"epoch"`
	CreatedAtMS             int64  `json:"created_at_ms"`
	Protocol                string `json:"protocol"`
	ServerAcknowledged      bool   `json:"server_acknowledged"`
	LocalCleanupComplete    bool   `json:"local_cleanup_complete"`
	AcknowledgedAtMS        int64  `json:"acknowledged_at_ms"`
	ResponseValidated       bool   `json:"response_validated"`
	UploadLifecycleFenced   *bool  `json:"upload_lifecycle_fenced,omitempty"`
	UploadLifecycleFenceVer *int   `json:"upload_lifecycle_fence_version,omitempty"`
	RuntimeUploadEnabled    *bool  `json:"runtime_upload_enabled,omitempty"`
	RuntimeMessagingEnabled *bool  `json:"runtime_messaging_enabled,omitempty"`
}

type whatsmeowWWebPQCapabilities struct {
	Migrated                          *bool     `json:"pq_migrated"`
	UploadEnabled                     *bool     `json:"pq_upload_enabled"`
	MessagingEnabled                  *bool     `json:"pq_messaging_enabled"`
	StorageMode                       *string   `json:"pq_storage_mode"`
	PreKeyCount                       *int64    `json:"pq_pre_key_count"`
	LastResortKeyCount                *int64    `json:"pq_last_resort_key_count"`
	RollbackAcknowledged              *bool     `json:"pq_server_rollback_acknowledged"`
	RollbackProtocol                  *string   `json:"pq_server_rollback_protocol"`
	RollbackHandoffID                 *string   `json:"pq_server_rollback_handoff_id"`
	RollbackLifecycleOperationID      *string   `json:"pq_server_rollback_lifecycle_operation_id"`
	RollbackSourceRevisionID          *string   `json:"pq_server_rollback_source_revision_id"`
	RollbackOwnerID                   *string   `json:"pq_server_rollback_owner_id"`
	RollbackFencingToken              *string   `json:"pq_server_rollback_fencing_token"`
	RollbackGeneration                *int      `json:"pq_server_rollback_generation"`
	RollbackEpoch                     *string   `json:"pq_server_rollback_epoch"`
	RollbackAcknowledgedAtMS          *int64    `json:"pq_server_rollback_acknowledged_at_ms"`
	RollbackResponseValidated         *bool     `json:"pq_server_rollback_response_validated"`
	UploadLifecycleFenced             *bool     `json:"pq_upload_lifecycle_fenced"`
	UploadLifecycleFenceVersion       *int      `json:"pq_upload_lifecycle_fence_version"`
	RuntimeUploadEnabled              *bool     `json:"pq_runtime_upload_enabled"`
	RuntimeMessagingEnabled           *bool     `json:"pq_runtime_messaging_enabled"`
	AppStateSnapshotResyncRequired    *bool     `json:"app_state_snapshot_resync_required"`
	AppStateSnapshotResyncCollections *[]string `json:"app_state_snapshot_resync_collections"`
}

type whatsmeowWWebCanonicalMetadata struct {
	SchemaVersion int                         `json:"schema_version"`
	CodecKind     string                      `json:"codec_kind"`
	CodecVersion  int                         `json:"codec_version"`
	ModuleABI     string                      `json:"module_abi"`
	Complete      bool                        `json:"complete"`
	Capabilities  whatsmeowWWebPQCapabilities `json:"capabilities"`
}

func isNonNilWhatsmeowUUID(value string) bool {
	parsed, err := uuid.Parse(value)
	return err == nil && parsed != uuid.Nil
}

func validateWhatsmeowPQRollbackMarker(
	marker whatsmeowPQRollbackMarker,
	sourceProvider string,
	sourceRevisionID int64,
	handoffID string,
	lifecycleOperationID string,
) error {
	if marker.Version != 1 || marker.State != "acknowledged" ||
		marker.HandoffID != handoffID ||
		marker.LifecycleOperationID != lifecycleOperationID ||
		marker.SourceRevisionID != strconv.FormatInt(sourceRevisionID, 10) ||
		marker.TargetProvider != "whatsmeow" ||
		!isNonNilWhatsmeowUUID(marker.HandoffID) ||
		!isNonNilWhatsmeowUUID(marker.LifecycleOperationID) ||
		!isNonNilWhatsmeowUUID(marker.OwnerID) ||
		!isNonNilWhatsmeowUUID(marker.Epoch) ||
		marker.Generation <= 0 || marker.CreatedAtMS <= 0 ||
		marker.AcknowledgedAtMS < marker.CreatedAtMS ||
		marker.Protocol != whatsmeowPQRollbackProtocol ||
		!marker.ServerAcknowledged || !marker.LocalCleanupComplete ||
		!marker.ResponseValidated ||
		marker.UploadLifecycleFenced == nil ||
		!*marker.UploadLifecycleFenced ||
		marker.UploadLifecycleFenceVer == nil ||
		*marker.UploadLifecycleFenceVer != whatsmeowPQUploadLifecycleFenceV1 {
		return fmt.Errorf("whatsmeow_%s_pq_rollback_proof_invalid", sourceProvider)
	}
	if fencingToken, err := strconv.ParseInt(marker.FencingToken, 10, 64); err != nil || fencingToken <= 0 {
		return fmt.Errorf("whatsmeow_%s_pq_rollback_proof_invalid", sourceProvider)
	}
	if sourceProvider == "wwebjs" &&
		(marker.RuntimeUploadEnabled == nil || marker.RuntimeMessagingEnabled == nil) {
		return errors.New("whatsmeow_wwebjs_pq_rollback_proof_invalid")
	}
	return nil
}

func readWhatsmeowPQRollbackMarker(
	ctx context.Context,
	queryer interface {
		QueryRowContext(context.Context, string, ...any) *sql.Row
	},
	sourceSessionID string,
	sourceRevisionID int64,
	sourceProvider string,
	handoffID string,
	lifecycleOperationID string,
) (whatsmeowPQRollbackMarker, error) {
	namespace := whatsmeowWWebLifecycleNamespace
	recordKey := whatsmeowWWebPQRollbackMarkerKey
	if sourceProvider == "baileys" {
		namespace = whatsmeowBaileysHandoffNamespace
		recordKey = "pq_server_rollback:" + handoffID
	}
	var payload []byte
	var payloadBytes int
	err := queryer.QueryRowContext(ctx, `
		SELECT payload, octet_length(payload)
		FROM whatsapp_provider_record
		WHERE session_id=$1::uuid AND revision_id=$2
		  AND namespace=$3 AND record_key=$4 AND codec_version=1
	`, sourceSessionID, sourceRevisionID, namespace, recordKey).Scan(
		&payload, &payloadBytes,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return whatsmeowPQRollbackMarker{}, fmt.Errorf(
			"whatsmeow_%s_pq_rollback_proof_missing", sourceProvider,
		)
	}
	if err != nil {
		return whatsmeowPQRollbackMarker{}, fmt.Errorf(
			"read %s PQ rollback proof: %w", sourceProvider, err,
		)
	}
	if payloadBytes != len(payload) || payloadBytes <= 0 ||
		payloadBytes > whatsmeowWWebMetadataMaxBytes {
		return whatsmeowPQRollbackMarker{}, fmt.Errorf(
			"whatsmeow_%s_pq_rollback_proof_invalid", sourceProvider,
		)
	}
	var marker whatsmeowPQRollbackMarker
	if err := json.Unmarshal(payload, &marker); err != nil {
		return whatsmeowPQRollbackMarker{}, fmt.Errorf(
			"whatsmeow_%s_pq_rollback_proof_invalid", sourceProvider,
		)
	}
	if err := validateWhatsmeowPQRollbackMarker(
		marker, sourceProvider, sourceRevisionID, handoffID,
		lifecycleOperationID,
	); err != nil {
		return whatsmeowPQRollbackMarker{}, err
	}
	return marker, nil
}

func validateWhatsmeowWWebPQMetadata(
	payload []byte,
	recordCodecVersion int,
	pqSignalSessionCount int64,
	marker whatsmeowPQRollbackMarker,
) error {
	if len(payload) == 0 || len(payload) > whatsmeowWWebMetadataMaxBytes ||
		recordCodecVersion != 1 || pqSignalSessionCount < 0 {
		return errors.New("whatsmeow_wwebjs_pqxdh_state_unknown")
	}
	var metadata whatsmeowWWebCanonicalMetadata
	if err := json.Unmarshal(payload, &metadata); err != nil ||
		metadata.SchemaVersion != sqlstore.SharedSchemaVersion ||
		metadata.CodecKind != whatsmeowWWebCanonicalCodecKind ||
		metadata.CodecVersion != 1 ||
		metadata.ModuleABI != whatsmeowWWebCanonicalModuleABI ||
		!metadata.Complete {
		return errors.New("whatsmeow_wwebjs_pqxdh_state_unknown")
	}
	capabilities := metadata.Capabilities
	if _, err := whatsmeowAppStateSnapshotResyncRequirementFromCapabilities(capabilities); err != nil {
		return err
	}
	if capabilities.Migrated == nil || capabilities.UploadEnabled == nil ||
		capabilities.MessagingEnabled == nil || capabilities.StorageMode == nil ||
		capabilities.PreKeyCount == nil || capabilities.LastResortKeyCount == nil ||
		*capabilities.PreKeyCount < 0 || *capabilities.LastResortKeyCount < 0 ||
		(*capabilities.StorageMode != "legacy_tables" &&
			*capabilities.StorageMode != "rollout_without_tables") {
		return errors.New("whatsmeow_wwebjs_pqxdh_state_unknown")
	}
	if capabilities.RollbackAcknowledged == nil ||
		!*capabilities.RollbackAcknowledged ||
		capabilities.RollbackProtocol == nil ||
		*capabilities.RollbackProtocol != marker.Protocol ||
		capabilities.RollbackHandoffID == nil ||
		*capabilities.RollbackHandoffID != marker.HandoffID ||
		capabilities.RollbackLifecycleOperationID == nil ||
		*capabilities.RollbackLifecycleOperationID != marker.LifecycleOperationID ||
		capabilities.RollbackSourceRevisionID == nil ||
		*capabilities.RollbackSourceRevisionID != marker.SourceRevisionID ||
		capabilities.RollbackOwnerID == nil ||
		*capabilities.RollbackOwnerID != marker.OwnerID ||
		capabilities.RollbackFencingToken == nil ||
		*capabilities.RollbackFencingToken != marker.FencingToken ||
		capabilities.RollbackGeneration == nil ||
		*capabilities.RollbackGeneration != marker.Generation ||
		capabilities.RollbackEpoch == nil ||
		*capabilities.RollbackEpoch != marker.Epoch ||
		capabilities.RollbackAcknowledgedAtMS == nil ||
		*capabilities.RollbackAcknowledgedAtMS != marker.AcknowledgedAtMS ||
		capabilities.RollbackResponseValidated == nil ||
		!*capabilities.RollbackResponseValidated ||
		capabilities.UploadLifecycleFenced == nil ||
		marker.UploadLifecycleFenced == nil ||
		!*capabilities.UploadLifecycleFenced ||
		!*marker.UploadLifecycleFenced ||
		*capabilities.UploadLifecycleFenced != *marker.UploadLifecycleFenced ||
		capabilities.UploadLifecycleFenceVersion == nil ||
		marker.UploadLifecycleFenceVer == nil ||
		*capabilities.UploadLifecycleFenceVersion != whatsmeowPQUploadLifecycleFenceV1 ||
		*marker.UploadLifecycleFenceVer != whatsmeowPQUploadLifecycleFenceV1 ||
		*capabilities.UploadLifecycleFenceVersion != *marker.UploadLifecycleFenceVer ||
		capabilities.RuntimeUploadEnabled == nil ||
		marker.RuntimeUploadEnabled == nil ||
		*capabilities.RuntimeUploadEnabled != *marker.RuntimeUploadEnabled ||
		capabilities.RuntimeMessagingEnabled == nil ||
		marker.RuntimeMessagingEnabled == nil ||
		*capabilities.RuntimeMessagingEnabled != *marker.RuntimeMessagingEnabled {
		return errors.New("whatsmeow_wwebjs_pq_rollback_proof_diverged")
	}
	if *capabilities.Migrated || *capabilities.PreKeyCount != 0 ||
		*capabilities.LastResortKeyCount != 0 || pqSignalSessionCount != 0 {
		return errors.New("whatsmeow_wwebjs_pqxdh_state_unportable")
	}
	return nil
}

func validateWhatsmeowBaileysPQState(
	pqStateCount, pqMigratedCount, pqPreKeyCount, pqSignalSessionCount,
	pqProviderKeyRecordCount, pqProviderStateRecordCount int64,
) error {
	if pqStateCount < 0 || pqMigratedCount < 0 || pqPreKeyCount < 0 || pqSignalSessionCount < 0 ||
		pqProviderKeyRecordCount < 0 || pqProviderStateRecordCount < 0 {
		return errors.New("whatsmeow_baileys_pqxdh_state_unknown")
	}
	if pqStateCount != 1 || pqMigratedCount != 0 || pqPreKeyCount != 0 || pqSignalSessionCount != 0 ||
		pqProviderKeyRecordCount != 0 || pqProviderStateRecordCount != 1 {
		return errors.New("whatsmeow_baileys_pqxdh_state_unportable")
	}
	return nil
}

func assertWhatsmeowHandoffSourceCompatibility(
	ctx context.Context,
	queryer interface {
		QueryRowContext(context.Context, string, ...any) *sql.Row
	},
	sourceSessionID string,
	sourceRevisionID int64,
	sourceProvider string,
	handoffID string,
	lifecycleOperationID string,
) error {
	_, err := inspectWhatsmeowHandoffSourceCompatibility(
		ctx, queryer, sourceSessionID, sourceRevisionID, sourceProvider,
		handoffID, lifecycleOperationID,
	)
	return err
}

func inspectWhatsmeowHandoffSourceCompatibility(
	ctx context.Context,
	queryer interface {
		QueryRowContext(context.Context, string, ...any) *sql.Row
	},
	sourceSessionID string,
	sourceRevisionID int64,
	sourceProvider string,
	handoffID string,
	lifecycleOperationID string,
) (whatsmeowAppStateSnapshotResyncRequirement, error) {
	marker, err := readWhatsmeowPQRollbackMarker(
		ctx, queryer, sourceSessionID, sourceRevisionID, sourceProvider,
		handoffID, lifecycleOperationID,
	)
	if err != nil {
		return whatsmeowAppStateSnapshotResyncRequirement{}, err
	}
	if sourceProvider == "baileys" {
		var pqStateCount, pqMigratedCount, pqPreKeyCount, pqSignalSessionCount int64
		var pqProviderKeyRecordCount, pqProviderStateRecordCount int64
		err := queryer.QueryRowContext(ctx, `
			SELECT
			  (SELECT COUNT(*)
			   FROM whatsapp_pq_pre_key_state AS state
			   WHERE state.session_id=$1::uuid AND state.revision_id=$2),
			  (SELECT COUNT(*)
			   FROM whatsapp_pq_pre_key_state AS state
			   WHERE state.session_id=$1::uuid AND state.revision_id=$2
			     AND state.migrated),
			  (SELECT COUNT(*)
			   FROM whatsapp_pq_pre_keys AS pre_key
			   WHERE pre_key.session_id=$1::uuid AND pre_key.revision_id=$2),
			  (SELECT COUNT(*)
			   FROM whatsapp_signal_sessions AS signal_session
			   WHERE signal_session.session_id=$1::uuid
			     AND signal_session.revision_id=$2
			     AND signal_session.scope='pq'),
			  (SELECT COUNT(*)
			   FROM whatsapp_provider_record AS record
			   WHERE record.session_id=$1::uuid AND record.revision_id=$2
			     AND record.namespace IN (
			       'baileys/signal/pq-pre-key',
			       'baileys/signal/pq-last-resort-key'
			     )),
			  (SELECT COUNT(*)
			   FROM whatsapp_provider_record AS record
			   WHERE record.session_id=$1::uuid AND record.revision_id=$2
			     AND record.namespace='baileys/signal/pq-pre-key-state')
		`, sourceSessionID, sourceRevisionID).Scan(
			&pqStateCount,
			&pqMigratedCount,
			&pqPreKeyCount,
			&pqSignalSessionCount,
			&pqProviderKeyRecordCount,
			&pqProviderStateRecordCount,
		)
		if err != nil {
			return whatsmeowAppStateSnapshotResyncRequirement{}, fmt.Errorf("read baileys canonical PQXDH state: %w", err)
		}
		if err := validateWhatsmeowBaileysPQState(
			pqStateCount,
			pqMigratedCount,
			pqPreKeyCount,
			pqSignalSessionCount,
			pqProviderKeyRecordCount,
			pqProviderStateRecordCount,
		); err != nil {
			return whatsmeowAppStateSnapshotResyncRequirement{}, err
		}
		return whatsmeowAppStateSnapshotResyncRequirement{}, nil
	}
	if sourceProvider != "wwebjs" {
		return whatsmeowAppStateSnapshotResyncRequirement{}, nil
	}
	var recordCodecVersion, payloadBytes int
	var hasPQSignalSession bool
	var payload []byte
	err = queryer.QueryRowContext(ctx, `
		SELECT metadata.codec_version, metadata.payload,
		       octet_length(metadata.payload),
		       EXISTS (
		         SELECT 1
		         FROM whatsapp_signal_sessions AS signal_session
		         WHERE signal_session.session_id=metadata.session_id
		           AND signal_session.revision_id=metadata.revision_id
		           AND signal_session.scope='pq'
		       )
		FROM whatsapp_provider_record AS metadata
		WHERE metadata.session_id=$1::uuid AND metadata.revision_id=$2
		  AND metadata.namespace=$3 AND metadata.record_key=$4
	`, sourceSessionID, sourceRevisionID,
		whatsmeowWWebCanonicalMetaNamespace,
		whatsmeowWWebCanonicalMetaKey,
	).Scan(&recordCodecVersion, &payload, &payloadBytes, &hasPQSignalSession)
	if errors.Is(err, sql.ErrNoRows) {
		return whatsmeowAppStateSnapshotResyncRequirement{}, errors.New("whatsmeow_wwebjs_pqxdh_state_unknown")
	}
	if err != nil {
		return whatsmeowAppStateSnapshotResyncRequirement{}, fmt.Errorf("read wwebjs canonical PQXDH metadata: %w", err)
	}
	if payloadBytes != len(payload) {
		return whatsmeowAppStateSnapshotResyncRequirement{}, errors.New("whatsmeow_wwebjs_pqxdh_state_unknown")
	}
	var pqSignalSessionCount int64
	if hasPQSignalSession {
		pqSignalSessionCount = 1
	}
	if err := validateWhatsmeowWWebPQMetadata(
		payload, recordCodecVersion, pqSignalSessionCount, marker,
	); err != nil {
		return whatsmeowAppStateSnapshotResyncRequirement{}, err
	}
	var metadata whatsmeowWWebCanonicalMetadata
	if err := json.Unmarshal(payload, &metadata); err != nil {
		return whatsmeowAppStateSnapshotResyncRequirement{}, errors.New(
			"whatsmeow_wwebjs_app_state_snapshot_resync_manifest_invalid",
		)
	}
	return whatsmeowAppStateSnapshotResyncRequirementFromCapabilities(
		metadata.Capabilities,
	)
}

type whatsmeowOperationFence struct {
	OwnerID      string
	FencingToken int64
	Generation   int
	Epoch        string
	Capability   string
}

type whatsmeowRuntimeFenceActivator interface {
	ActivateRuntimeFence(
		context.Context,
		Config,
		WhatsappRuntimeFenceActivationRequest,
	) (WhatsappRuntimeFenceActivationResponse, error)
}

func activateWhatsmeowSecureImportFence(
	ctx context.Context,
	cfg Config,
	connectionEpoch string,
	activator whatsmeowRuntimeFenceActivator,
) error {
	if activator == nil {
		return errors.New("whatsmeow secure import runtime fence is unavailable")
	}
	if _, err := uuid.Parse(connectionEpoch); err != nil {
		return errors.New("whatsmeow secure import connection epoch is invalid")
	}
	_, err := activator.ActivateRuntimeFence(ctx, cfg, WhatsappRuntimeFenceActivationRequest{
		WorkerID:          cfg.WorkerID,
		AccountID:         cfg.AccountID,
		SourceProvider:    "whatsmeow",
		RuntimeGeneration: cfg.RuntimeGeneration,
		ConnectionEpoch:   connectionEpoch,
	})
	if err != nil {
		return fmt.Errorf("fence whatsmeow secure import: %w", err)
	}
	return nil
}

func whatsmeowSecureImportConnectionEpoch(cfg Config, importKey string) (string, error) {
	workerNamespace, err := uuid.Parse(strings.TrimSpace(cfg.WorkerID))
	if err != nil {
		return "", errors.New("whatsmeow secure import worker ID is invalid")
	}
	key := strings.TrimSpace(importKey)
	if key == "" {
		return "", errors.New("whatsmeow secure import identity is missing")
	}
	return uuid.NewSHA1(
		workerNamespace,
		[]byte("underchat:whatsmeow:secure-import:"+key),
	).String(), nil
}

func (m *WhatsAppManager) restoreWhatsmeowPostgresStore(ctx context.Context, req SecureSessionImportRequest, storeDB []byte) (ConnectionState, error) {
	m.sessionMu.Lock()
	defer m.sessionMu.Unlock()
	if m.postgres == nil || m.postgres.DB == nil {
		return ConnectionState{}, errors.New("worker database is unavailable for postgres secure import")
	}

	tempDir, err := os.MkdirTemp("", "underchat-whatsmeow-pg-import-*")
	if err != nil {
		return ConnectionState{}, fmt.Errorf("create secure import temp dir: %w", err)
	}
	defer os.RemoveAll(tempDir)
	dbPath := filepath.Join(tempDir, "store.db")
	if err := os.WriteFile(dbPath, storeDB, 0o600); err != nil {
		return ConnectionState{}, fmt.Errorf("write secure import store: %w", err)
	}

	// Imported SQLite projections are opened read-only and their original
	// session/revision ownership is never reused at the destination.
	sourceDB, err := sql.Open("sqlite3", "file:"+dbPath+"?mode=ro&_foreign_keys=on")
	if err != nil {
		return ConnectionState{}, fmt.Errorf("open secure import projection: %w", err)
	}
	sourceDB.SetMaxOpenConns(1)
	defer sourceDB.Close()
	candidate, err := captureWhatsmeowSQLiteSnapshot(ctx, sourceDB)
	if err != nil {
		return ConnectionState{}, err
	}
	prepared, err := prepareWhatsmeowSnapshot(candidate)
	if err != nil {
		return ConnectionState{}, fmt.Errorf("validate secure import projection: %w", err)
	}

	activeScope, activeScopeErr := m.captureActiveConnectionScope(ctx)
	importKey := strings.TrimSpace(req.ConnectionAttemptID)
	if importKey == "" {
		digest := sha256.Sum256(storeDB)
		importKey = hex.EncodeToString(digest[:])
	}
	connectionEpoch, err := whatsmeowSecureImportConnectionEpoch(m.cfg, importKey)
	if err != nil {
		return ConnectionState{}, err
	}
	if activeScopeErr == nil {
		connectionEpoch = activeScope.ConnectionEpoch
	}

	_ = m.beginFencedProviderLifecycleEvent()
	m.deactivateInboundConnectionScope(ctx)
	m.closeCurrentWhatsmeowClient()
	if err := activateWhatsmeowSecureImportFence(ctx, m.cfg, connectionEpoch, m.postgres); err != nil {
		_ = m.initClient(ctx)
		return ConnectionState{}, err
	}
	stage, err := m.postgres.stageWhatsmeowSecureImport(ctx, m.cfg, candidate, prepared, storeDB)
	if err != nil {
		_ = m.initClient(ctx)
		return ConnectionState{}, err
	}

	m.secureImportInProgress.Store(true)
	m.secureImportRevision.Store(stage.CandidateRevision)
	defer func() {
		m.secureImportRevision.Store(0)
		m.secureImportInProgress.Store(false)
	}()

	rollback := func(reason string) {
		m.closeCurrentWhatsmeowClient()
		if rollbackErr := m.postgres.rollbackWhatsmeowSecureImport(context.Background(), m.cfg, stage); rollbackErr != nil {
			log.Printf("whatsmeow postgres secure import rollback failed worker_id=%s reason=%s error_code=%s", m.cfg.WorkerID, reason, safeOperationalErrorCode(rollbackErr))
		}
		m.secureImportRevision.Store(0)
		m.secureImportInProgress.Store(false)
		if initErr := m.initClient(context.Background()); initErr != nil {
			log.Printf("whatsmeow postgres secure import restore init failed worker_id=%s reason=%s error_code=%s", m.cfg.WorkerID, reason, safeOperationalErrorCode(initErr))
		}
	}

	if err := m.initClient(ctx); err != nil {
		rollback("init_client_failed")
		return ConnectionState{}, fmt.Errorf("initialize imported whatsmeow store: %w", err)
	}
	client := m.getClient()
	if client == nil || client.Store == nil || client.Store.ID == nil {
		rollback("missing_store_id")
		return ConnectionState{}, errors.New("imported whatsmeow store has no device identity")
	}
	m.setConnectionAttemptID(req.ConnectionAttemptID)
	m.mu.Lock()
	m.connected = false
	m.status = "connecting"
	m.code = CodeAwaitConnection
	m.degradedReason = ""
	m.mu.Unlock()
	m.publishState(ctx, "connecting", CodeAwaitConnection, WorkerStatusDisponible, "", "", true)

	if err := m.connectClient(m.connectionContext(), client, "secure-session-import-postgres"); err != nil {
		rollback("connect_failed")
		return ConnectionState{}, fmt.Errorf("connect imported whatsmeow store: %w", err)
	}
	phone := phoneFromOwnID(client.Store.ID)
	health := m.waitForSessionReady(ctx, "secure-session-import-postgres")
	if !healthBool(health, "session_ready") {
		state := ensureSecureImportNotReadyState(
			m.secureImportCurrentState(req, phone),
			"secure_session_import_not_ready",
			"Imported whatsmeow store connected, but session readiness was not confirmed.",
		)
		rollback("session_not_ready")
		return state, nil
	}
	if err := m.postgres.promoteWhatsmeowSecureImport(ctx, m.cfg, stage); err != nil {
		rollback("promotion_failed")
		return ConnectionState{}, fmt.Errorf("promote imported whatsmeow store: %w", err)
	}
	state := m.secureImportCurrentState(req, phone)
	state.Code = CodeConnectionEstablished
	state.Status = "connected"
	state.WorkerStatusID = WorkerStatusOnline
	m.enrichReadiness(&state)
	return state, nil
}

// Recovery never reconstructs or copies a backup. The previous revision is
// still intact, so the canonical rollback only fences the candidate and
// atomically points the session header back to the source revision.
func (p *WorkerPostgres) recoverInterruptedWhatsmeowImport(ctx context.Context, cfg Config) error {
	activeRevision, _, err := p.OpenSessionRevision(ctx, cfg)
	if err != nil {
		return err
	}
	fence, err := p.whatsmeowFence(cfg)
	if err != nil {
		return err
	}
	tx, err := p.DB.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := beginWhatsmeowSessionOperation(ctx, tx, cfg.WorkerID, activeRevision, fence); err != nil {
		return err
	}
	stage := whatsmeowImportStage{PreviousRevision: activeRevision}
	err = tx.QueryRowContext(ctx, `
		SELECT handoff.target_revision_id, handoff.source_revision_id,
			handoff.handoff_id::text
		FROM whatsapp_session_handoff AS handoff
		JOIN whatsapp_session_revision AS target
		  ON target.session_id=handoff.session_id
		 AND target.revision_id=handoff.target_revision_id
		WHERE handoff.session_id=$1::uuid
		  AND handoff.source_provider='whatsmeow'
		  AND handoff.target_provider='whatsmeow'
		  AND target.source='secure_import'
		  AND handoff.state IN ('hydrating', 'validating', 'promoting')
		LIMIT 1
	`, cfg.WorkerID).Scan(&stage.CandidateRevision, &stage.PreviousRevision, &stage.HandoffID)
	if errors.Is(err, sql.ErrNoRows) {
		return tx.Commit()
	}
	if err != nil {
		return fmt.Errorf("read interrupted whatsapp import handoff: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	if err := p.rollbackWhatsmeowSecureImport(ctx, cfg, stage); err != nil {
		return err
	}
	logWhatsappSessionDebug(cfg.WhatsappSessionDebugEnabled, "import_recovered", map[string]any{
		"session_id":        cfg.WorkerID,
		"provider":          "whatsmeow",
		"revision":          stage.CandidateRevision,
		"previous_revision": stage.PreviousRevision,
		"stage":             "rollback",
	})
	return nil
}

// captureWhatsmeowSQLiteSnapshot accepts the current generic projection and
// the final pre-generic (v15) SQLite schema. Source ownership is used to filter
// reads, then discarded before insertion.
func captureWhatsmeowSQLiteSnapshot(ctx context.Context, db *sql.DB) (whatsmeowSessionSnapshot, error) {
	if db == nil {
		return whatsmeowSessionSnapshot{}, errors.New("whatsapp import projection is unavailable")
	}
	return captureCanonicalWhatsmeowSQLiteSnapshot(ctx, db)
}

func captureCanonicalWhatsmeowSQLiteSnapshot(ctx context.Context, db *sql.DB) (whatsmeowSessionSnapshot, error) {
	var versionRows, version, compatibility int
	if err := db.QueryRowContext(ctx, `
		SELECT COUNT(*), COALESCE(MIN(version), 0), COALESCE(MIN(compat), 0)
		FROM whatsapp_store_version
	`).Scan(&versionRows, &version, &compatibility); err != nil {
		return whatsmeowSessionSnapshot{}, fmt.Errorf("read imported whatsapp schema version: %w", err)
	}
	if versionRows != 1 || version != sqlstore.SharedSchemaVersion || compatibility != sqlstore.SharedSchemaVersion {
		return whatsmeowSessionSnapshot{}, fmt.Errorf(
			"unsupported imported whatsapp schema: rows=%d version=%d compat=%d",
			versionRows, version, compatibility,
		)
	}
	rows, err := db.QueryContext(ctx, `
		SELECT session_id, revision_id, jid, device_fingerprint,
		       fingerprint_version, next_pre_key_id
		FROM whatsapp_device
		WHERE jid IS NOT NULL
		LIMIT 2
	`)
	if err != nil {
		return whatsmeowSessionSnapshot{}, fmt.Errorf("read imported whatsmeow device: %w", err)
	}
	defer rows.Close()
	type sourceScope struct {
		sessionID          string
		revisionID         int64
		jid                string
		fingerprint        []byte
		fingerprintVersion string
		nextPreKeyID       int64
	}
	var scopes []sourceScope
	for rows.Next() {
		var scope sourceScope
		if err := rows.Scan(
			&scope.sessionID, &scope.revisionID, &scope.jid,
			&scope.fingerprint, &scope.fingerprintVersion, &scope.nextPreKeyID,
		); err != nil {
			return whatsmeowSessionSnapshot{}, err
		}
		scopes = append(scopes, scope)
	}
	if err := rows.Err(); err != nil {
		return whatsmeowSessionSnapshot{}, err
	}
	if len(scopes) != 1 {
		return whatsmeowSessionSnapshot{}, fmt.Errorf("secure import must contain exactly one whatsapp device revision, got %d", len(scopes))
	}
	if _, err := uuid.Parse(scopes[0].sessionID); err != nil {
		return whatsmeowSessionSnapshot{}, errors.New("secure import source session ID is invalid")
	}
	if scopes[0].revisionID <= 0 {
		return whatsmeowSessionSnapshot{}, errors.New("secure import source revision ID is invalid")
	}
	if _, err := types.ParseJID(scopes[0].jid); err != nil {
		return whatsmeowSessionSnapshot{}, fmt.Errorf("secure import device JID is invalid: %w", err)
	}
	if len(scopes[0].fingerprint) != sha256.Size {
		return whatsmeowSessionSnapshot{}, errors.New("secure import device fingerprint is incomplete")
	}
	if scopes[0].fingerprintVersion != sqlstore.DeviceFingerprintVersion {
		return whatsmeowSessionSnapshot{}, errors.New("secure import device fingerprint version is unsupported")
	}
	var sourceSchemaVersion, sourceCodecVersion int
	var sourceRevisionOrigin sql.NullString
	if err := db.QueryRowContext(ctx, `
		SELECT schema_version, codec_version, source
		FROM whatsapp_session_revision
		WHERE session_id=$1 AND revision_id=$2
	`, scopes[0].sessionID, scopes[0].revisionID).Scan(
		&sourceSchemaVersion, &sourceCodecVersion, &sourceRevisionOrigin,
	); err != nil {
		return whatsmeowSessionSnapshot{}, fmt.Errorf("read secure import revision metadata: %w", err)
	}
	if sourceSchemaVersion != sqlstore.SharedSchemaVersion || sourceCodecVersion != 1 {
		return whatsmeowSessionSnapshot{}, fmt.Errorf(
			"unsupported secure import revision codec: schema=%d codec=%d",
			sourceSchemaVersion, sourceCodecVersion,
		)
	}
	snapshot, err := captureWhatsmeowSnapshot(
		ctx,
		db,
		scopes[0].sessionID,
		scopes[0].revisionID,
		scopes[0].jid,
		scopes[0].nextPreKeyID,
	)
	if err != nil {
		return whatsmeowSessionSnapshot{}, err
	}
	snapshot.DeviceFingerprint = append([]byte(nil), scopes[0].fingerprint...)
	snapshot.FingerprintVersion = scopes[0].fingerprintVersion
	if sourceRevisionOrigin.Valid {
		snapshot.SourceRevisionOrigin = sourceRevisionOrigin.String
	}
	return snapshot, nil
}

func captureWhatsmeowSnapshot(ctx context.Context, queryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}, sourceSessionID string, sourceRevisionID int64, jid string, nextPreKeyID int64) (whatsmeowSessionSnapshot, error) {
	return captureWhatsmeowSnapshotForSourceProvider(
		ctx, queryer, sourceSessionID, sourceRevisionID, jid, nextPreKeyID, "",
	)
}

func captureWhatsmeowSnapshotForSourceProvider(ctx context.Context, queryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}, sourceSessionID string, sourceRevisionID int64, jid string, nextPreKeyID int64, sourceProvider string) (whatsmeowSessionSnapshot, error) {
	snapshot := whatsmeowSessionSnapshot{Version: 2, JID: jid, NextPreKeyID: nextPreKeyID}
	if jid == "" {
		return whatsmeowSessionSnapshot{}, errors.New("whatsapp snapshot JID is required")
	}
	totalRows := 0
	totalBytes := 0
	for _, descriptor := range whatsmeowPortableTables() {
		query := fmt.Sprintf(
			"SELECT %s FROM %s WHERE session_id=$1 AND revision_id=$2",
			strings.Join(descriptor.Columns, ","),
			descriptor.Name,
		)
		query += whatsmeowSnapshotSourceFilter(descriptor.Name, sourceProvider)
		if orderColumns := whatsmeowSnapshotOrderColumns[descriptor.Name]; len(orderColumns) > 0 {
			query += " ORDER BY " + strings.Join(orderColumns, ",")
		}
		rows, err := queryer.QueryContext(ctx, query, sourceSessionID, sourceRevisionID)
		if err != nil {
			return whatsmeowSessionSnapshot{}, fmt.Errorf("snapshot table %s: %w", descriptor.Name, err)
		}
		table := whatsmeowBackupTable{Name: descriptor.Name}
		for rows.Next() {
			raw := make([]any, len(descriptor.Columns))
			dest := make([]any, len(raw))
			for index := range raw {
				dest[index] = &raw[index]
			}
			if err := rows.Scan(dest...); err != nil {
				rows.Close()
				return whatsmeowSessionSnapshot{}, fmt.Errorf("scan table %s: %w", descriptor.Name, err)
			}
			converted := make([]whatsmeowBackupCell, len(raw))
			rowBytes := whatsmeowProjectionRowOverhead
			for index, value := range raw {
				cell, err := encodeWhatsmeowBackupCell(value, descriptor.Kinds[index])
				if err != nil {
					rows.Close()
					return whatsmeowSessionSnapshot{}, fmt.Errorf("encode %s.%s: %w", descriptor.Name, descriptor.Columns[index], err)
				}
				converted[index] = cell
				rowBytes += whatsmeowBackupCellSize(cell)
			}
			totalRows++
			totalBytes += rowBytes
			if totalRows > whatsmeowProjectionMaxRows || totalBytes > whatsmeowProjectionMaxBytes {
				rows.Close()
				return whatsmeowSessionSnapshot{}, fmt.Errorf(
					"whatsapp projection exceeds capture limits: rows=%d bytes=%d",
					totalRows, totalBytes,
				)
			}
			table.Rows = append(table.Rows, converted)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return whatsmeowSessionSnapshot{}, err
		}
		rows.Close()
		snapshot.Tables = append(snapshot.Tables, table)
	}
	return snapshot, nil
}

func whatsmeowSnapshotSourceFilter(tableName, sourceProvider string) string {
	// WhatsMeow advances only the default libsignal store, regardless of which
	// provider produced the candidate. Status and PQ ratchets must be rebuilt by
	// a provider that owns those scopes, never retained as pass-through state
	// that would become stale while WhatsMeow is active.
	if tableName == "whatsapp_signal_sessions" {
		return " AND scope='default'"
	} else if tableName == "whatsapp_app_state_mutation_macs" && sourceProvider == "wwebjs" {
		// WWeb's sync-actions store can retain queued MACs above the official
		// collection watermark after a stable browser sync. Those rows were not
		// committed into the LT-hash and cannot be imported as canonical state.
		// Keep all confirmed MACs and let WhatsMeow's authenticated snapshot sync
		// rebuild only the private future queue.
		return ` AND EXISTS (
			SELECT 1 FROM whatsapp_app_state_version AS version
			WHERE version.session_id=whatsapp_app_state_mutation_macs.session_id
			  AND version.revision_id=whatsapp_app_state_mutation_macs.revision_id
			  AND version.name=whatsapp_app_state_mutation_macs.name
			  AND whatsapp_app_state_mutation_macs.version <= version.version
		)`
	} else if tableName == whatsmeowTransportTable.Name {
		return " AND namespace='whatsapp/transport' AND record_key='routing_info'"
	}
	return ""
}

func whatsmeowBackupCellSize(cell whatsmeowBackupCell) int {
	switch cell.Kind {
	case string(whatsmeowText):
		return len(cell.Text)
	case string(whatsmeowBytes):
		return len(cell.Bytes)
	case string(whatsmeowInt):
		return 8
	case string(whatsmeowBool):
		return 1
	default:
		return 0
	}
}

// preflightWhatsmeowSnapshotBounds scans only aggregate metadata while the
// source revision is exposed through the read-only RLS handoff scope. It
// rejects an oversized source before rows are materialized in Go or any target
// transaction begins. captureWhatsmeowSnapshot repeats the cap incrementally
// as defense in depth against representation-size differences.
func preflightWhatsmeowSnapshotBounds(
	ctx context.Context,
	tx *sql.Tx,
	sourceSessionID string,
	sourceRevisionID int64,
) (int64, int64, error) {
	return preflightWhatsmeowSnapshotBoundsForSourceProvider(
		ctx, tx, sourceSessionID, sourceRevisionID, "",
	)
}

func preflightWhatsmeowSnapshotBoundsForSourceProvider(
	ctx context.Context,
	tx *sql.Tx,
	sourceSessionID string,
	sourceRevisionID int64,
	sourceProvider string,
) (int64, int64, error) {
	if tx == nil || sourceSessionID == "" || sourceRevisionID <= 0 {
		return 0, 0, errors.New("whatsapp projection preflight scope is invalid")
	}
	var totalRows, totalBytes int64
	for _, descriptor := range whatsmeowPortableTables() {
		// Names and columns come exclusively from the static descriptor list.
		query := fmt.Sprintf(`
			SELECT COUNT(*), COALESCE(SUM(pg_column_size(projected)), 0)
			FROM (
				SELECT %s FROM %s
				WHERE session_id=$1::uuid AND revision_id=$2%s
			) AS projected
		`, strings.Join(descriptor.Columns, ","), descriptor.Name,
			whatsmeowSnapshotSourceFilter(descriptor.Name, sourceProvider))
		var tableRows, tableBytes int64
		if err := tx.QueryRowContext(
			ctx, query, sourceSessionID, sourceRevisionID,
		).Scan(&tableRows, &tableBytes); err != nil {
			return 0, 0, fmt.Errorf("preflight snapshot table %s: %w", descriptor.Name, err)
		}
		if tableRows < 0 || tableBytes < 0 {
			return 0, 0, errors.New("whatsapp projection preflight returned invalid totals")
		}
		totalRows += tableRows
		totalBytes += tableBytes
		if totalRows > whatsmeowProjectionMaxRows || totalBytes > whatsmeowProjectionMaxBytes {
			return totalRows, totalBytes, fmt.Errorf(
				"whatsapp projection exceeds preflight limits: rows=%d bytes=%d",
				totalRows, totalBytes,
			)
		}
	}
	return totalRows, totalBytes, nil
}

func encodeWhatsmeowBackupCell(value any, kind whatsmeowColumnKind) (whatsmeowBackupCell, error) {
	if value == nil {
		return whatsmeowBackupCell{Kind: "null"}, nil
	}
	cell := whatsmeowBackupCell{Kind: string(kind)}
	switch kind {
	case whatsmeowText:
		switch typed := value.(type) {
		case string:
			cell.Text = typed
		case []byte:
			cell.Text = string(typed)
		default:
			cell.Text = fmt.Sprint(value)
		}
	case whatsmeowBytes:
		switch typed := value.(type) {
		case []byte:
			cell.Bytes = append([]byte(nil), typed...)
		case string:
			cell.Bytes = []byte(typed)
		default:
			return whatsmeowBackupCell{}, fmt.Errorf("unexpected binary value %T", value)
		}
	case whatsmeowInt:
		switch typed := value.(type) {
		case int64:
			cell.Int = typed
		case int:
			cell.Int = int64(typed)
		case []byte:
			parsed, err := strconv.ParseInt(string(typed), 10, 64)
			if err != nil {
				return whatsmeowBackupCell{}, err
			}
			cell.Int = parsed
		default:
			parsed, err := strconv.ParseInt(fmt.Sprint(value), 10, 64)
			if err != nil {
				return whatsmeowBackupCell{}, err
			}
			cell.Int = parsed
		}
	case whatsmeowBool:
		switch typed := value.(type) {
		case bool:
			cell.Bool = typed
		case int64:
			cell.Bool = typed != 0
		case []byte:
			cell.Bool = string(typed) == "1" || strings.EqualFold(string(typed), "true")
		default:
			cell.Bool = strings.EqualFold(fmt.Sprint(value), "true") || fmt.Sprint(value) == "1"
		}
	default:
		return whatsmeowBackupCell{}, fmt.Errorf("unknown column kind %q", kind)
	}
	return cell, nil
}

func (cell whatsmeowBackupCell) value() any {
	switch cell.Kind {
	case "null":
		return nil
	case string(whatsmeowText):
		return cell.Text
	case string(whatsmeowBytes):
		return append([]byte(nil), cell.Bytes...)
	case string(whatsmeowInt):
		return cell.Int
	case string(whatsmeowBool):
		return cell.Bool
	default:
		return nil
	}
}

func descriptorForWhatsmeowTable(name string) (whatsmeowTableDescriptor, bool) {
	for _, descriptor := range whatsmeowScopedTables {
		if descriptor.Name == name {
			return descriptor, true
		}
	}
	if name == whatsmeowTransportTable.Name {
		return whatsmeowTransportTable, true
	}
	return whatsmeowTableDescriptor{}, false
}

func prepareWhatsmeowSnapshot(snapshot whatsmeowSessionSnapshot) ([]whatsmeowPreparedTable, error) {
	if snapshot.Version != 2 || snapshot.JID == "" {
		return nil, errors.New("invalid whatsapp projection snapshot metadata")
	}
	if snapshot.FingerprintVersion != sqlstore.DeviceFingerprintVersion {
		return nil, errors.New("unsupported whatsapp projection fingerprint version")
	}
	seen := make(map[string]struct{}, len(snapshot.Tables))
	prepared := make([]whatsmeowPreparedTable, 0, len(snapshot.Tables))
	var deviceRow []whatsmeowBackupCell
	for _, table := range snapshot.Tables {
		descriptor, ok := descriptorForWhatsmeowTable(table.Name)
		if !ok {
			return nil, fmt.Errorf("unsupported whatsapp target table %q", table.Name)
		}
		if _, duplicate := seen[table.Name]; duplicate {
			return nil, fmt.Errorf("duplicate whatsapp target table %q", table.Name)
		}
		seen[table.Name] = struct{}{}
		target := whatsmeowPreparedTable{
			Name:    descriptor.Name,
			Columns: append([]string(nil), descriptor.Columns...),
			Rows:    make([][]any, 0, len(table.Rows)),
		}
		for _, row := range table.Rows {
			if len(row) != len(descriptor.Columns) {
				return nil, fmt.Errorf("invalid %s snapshot row width", table.Name)
			}
			normalizedRow := row
			if table.Name == "whatsapp_device" {
				normalizedRow = normalizeLegacySQLiteADVSecretSnapshotRow(
					descriptor,
					row,
					snapshot.SourceRevisionOrigin,
				)
			}
			values := make([]any, len(row))
			for index, cell := range normalizedRow {
				if cell.Kind != "null" && cell.Kind != string(descriptor.Kinds[index]) {
					return nil, fmt.Errorf("invalid %s.%s snapshot kind", table.Name, descriptor.Columns[index])
				}
				values[index] = cell.value()
			}
			if table.Name == "whatsapp_signal_sessions" {
				scope, ok := values[1].(string)
				if !ok || (scope != "default" && scope != "status" && scope != "pq") {
					return nil, errors.New("invalid whatsapp Signal session scope")
				}
				if scope != "default" {
					// Candidate-only physical filtering: source/previous revisions are
					// read-only and remain byte-identical for rollback.
					continue
				}
				// NULL is a valid canonical tombstone/placeholder for the default
				// scope and must remain SQL NULL.
				payloadValue := values[2]
				if payloadValue != nil {
					payload, ok := payloadValue.([]byte)
					if !ok {
						return nil, errors.New("invalid whatsapp Signal session payload")
					}
					canonical, normalizeErr := meowstore.NormalizeSignalSessionStorage(payload)
					if normalizeErr != nil {
						return nil, fmt.Errorf("normalize whatsapp Signal session: %w", normalizeErr)
					}
					values[2] = canonical
				}
			}
			if table.Name == "whatsapp_sender_keys" {
				payload, ok := values[2].([]byte)
				if !ok {
					return nil, errors.New("whatsapp sender-key payload is missing")
				}
				canonical, normalizeErr := meowstore.NormalizeSenderKeyStorage(payload)
				if normalizeErr != nil {
					return nil, fmt.Errorf("normalize whatsapp sender key: %w", normalizeErr)
				}
				values[2] = canonical
			}
			if table.Name == whatsmeowTransportTable.Name {
				if len(table.Rows) != 1 {
					return nil, errors.New("whatsapp transport projection contains duplicate routing records")
				}
				namespace, namespaceOK := values[0].(string)
				recordKey, recordKeyOK := values[1].(string)
				codecVersion, codecOK := values[2].(int64)
				payload, payloadOK := values[3].([]byte)
				if !namespaceOK || namespace != meowstore.WhatsAppTransportNamespace ||
					!recordKeyOK || recordKey != meowstore.WhatsAppTransportRoutingInfoKey ||
					!codecOK || codecVersion != meowstore.WhatsAppTransportCodecVersion ||
					!payloadOK || meowstore.ValidateWhatsAppTransportRoutingInfo(payload) != nil {
					return nil, errors.New("whatsapp transport projection routing record is invalid")
				}
			}
			target.Rows = append(target.Rows, values)
		}
		if table.Name == "whatsapp_device" {
			if len(table.Rows) != 1 {
				return nil, fmt.Errorf("secure import must contain exactly one device row, got %d", len(table.Rows))
			}
			deviceRow = normalizeLegacySQLiteADVSecretSnapshotRow(
				descriptor,
				table.Rows[0],
				snapshot.SourceRevisionOrigin,
			)
		}
		prepared = append(prepared, target)
	}
	for _, descriptor := range whatsmeowScopedTables {
		if _, ok := seen[descriptor.Name]; !ok {
			return nil, errors.New("whatsapp projection snapshot is missing protocol tables")
		}
	}
	if _, ok := seen[whatsmeowTransportTable.Name]; !ok {
		// Normalize older in-memory fixtures/artifacts to the same deterministic
		// empty transport projection emitted by current captures.
		prepared = append(prepared, whatsmeowPreparedTable{
			Name:    whatsmeowTransportTable.Name,
			Columns: append([]string(nil), whatsmeowTransportTable.Columns...),
		})
	}

	deviceDescriptor, _ := descriptorForWhatsmeowTable("whatsapp_device")
	fingerprint, err := importedWhatsmeowDeviceFingerprint(deviceDescriptor, deviceRow, snapshot.JID)
	if err != nil {
		return nil, err
	}
	if len(snapshot.DeviceFingerprint) > 0 && !equalBytes(snapshot.DeviceFingerprint, fingerprint[:]) {
		return nil, errors.New("whatsapp projection device fingerprint diverged")
	}
	nextPreKeyID, err := importedWhatsmeowNextPreKeyID(snapshot)
	if err != nil {
		return nil, err
	}
	for index := range prepared {
		if prepared[index].Name != "whatsapp_device" {
			continue
		}
		prepared[index].Columns = append(prepared[index].Columns, "device_fingerprint", "fingerprint_version", "next_pre_key_id")
		prepared[index].Rows[0] = append(prepared[index].Rows[0], fingerprint[:], sqlstore.DeviceFingerprintVersion, nextPreKeyID)
		break
	}
	return prepared, nil
}

// normalizeLegacySQLiteADVSecretSnapshotRow converts only the historical
// missing-secret sentinel emitted by the immutable v16 -> v17 SQLite upgrade.
// The SQLite loader already proves and accepts this representation only for a
// revision whose source is legacy_sqlite. PostgreSQL's canonical constraint
// represents the same public-only identity with SQL NULL instead.
//
// Keep this provenance gate exact. Canonical revisions and non-empty ADV
// material must still be rejected by importedWhatsmeowDeviceFingerprint.
func normalizeLegacySQLiteADVSecretSnapshotRow(
	descriptor whatsmeowTableDescriptor,
	row []whatsmeowBackupCell,
	sourceRevisionOrigin string,
) []whatsmeowBackupCell {
	if sourceRevisionOrigin != "legacy_sqlite" {
		return row
	}
	advKeyIndex, advAvailableIndex := -1, -1
	for index, column := range descriptor.Columns {
		switch column {
		case "adv_key":
			advKeyIndex = index
		case "adv_secret_available":
			advAvailableIndex = index
		}
	}
	if advKeyIndex < 0 || advAvailableIndex < 0 ||
		advKeyIndex >= len(row) || advAvailableIndex >= len(row) {
		return row
	}
	advKey := row[advKeyIndex]
	advAvailable := row[advAvailableIndex]
	if advKey.Kind != string(whatsmeowBytes) || len(advKey.Bytes) != 0 ||
		advAvailable.Kind != string(whatsmeowBool) || advAvailable.Bool {
		return row
	}
	normalized := append([]whatsmeowBackupCell(nil), row...)
	normalized[advKeyIndex] = whatsmeowBackupCell{Kind: "null"}
	return normalized
}

func importedWhatsmeowDeviceFingerprint(
	descriptor whatsmeowTableDescriptor,
	row []whatsmeowBackupCell,
	expectedJID string,
) ([32]byte, error) {
	var empty [32]byte
	cell := func(column string) (whatsmeowBackupCell, error) {
		for index, name := range descriptor.Columns {
			if name == column && index < len(row) {
				return row[index], nil
			}
		}
		return whatsmeowBackupCell{}, fmt.Errorf("whatsapp device column %s is missing", column)
	}
	requiredText := func(column string) (string, error) {
		value, err := cell(column)
		if err != nil {
			return "", err
		}
		if value.Kind != string(whatsmeowText) || value.Text == "" {
			return "", fmt.Errorf("whatsapp device column %s is empty", column)
		}
		return value.Text, nil
	}
	requiredBytes := func(column string, length int) ([]byte, error) {
		value, err := cell(column)
		if err != nil {
			return nil, err
		}
		if value.Kind != string(whatsmeowBytes) || value.Bytes == nil || (length > 0 && len(value.Bytes) != length) {
			return nil, fmt.Errorf("whatsapp device column %s has invalid length", column)
		}
		return value.Bytes, nil
	}

	jid, err := requiredText("jid")
	if err != nil {
		return empty, err
	}
	if jid != expectedJID {
		return empty, errors.New("whatsapp device JID changed while capturing snapshot")
	}
	advAvailable, err := cell("adv_secret_available")
	if err != nil || advAvailable.Kind != string(whatsmeowBool) {
		return empty, errors.New("whatsapp projection ADV capability is invalid")
	}
	identityPrivate, err := requiredBytes("identity_key", 32)
	if err != nil {
		return empty, err
	}
	noisePrivate, err := requiredBytes("noise_key", 32)
	if err != nil {
		return empty, err
	}
	signedPreKeyPrivate, err := requiredBytes("signed_pre_key", 32)
	if err != nil {
		return empty, err
	}
	signedPreKeySignature, err := requiredBytes("signed_pre_key_sig", 64)
	if err != nil {
		return empty, err
	}
	if err = sqlstore.ValidateCanonicalDeviceKeyMaterial(
		noisePrivate,
		identityPrivate,
		signedPreKeyPrivate,
		signedPreKeySignature,
	); err != nil {
		return empty, fmt.Errorf("whatsmeow_canonical_key_material_invalid: %w", err)
	}
	advKeyCell, err := cell("adv_key")
	if err != nil {
		return empty, err
	}
	var advKey []byte
	if advAvailable.Bool {
		if advKeyCell.Kind != string(whatsmeowBytes) || len(advKeyCell.Bytes) != 32 {
			return empty, errors.New("whatsapp projection ADV secret is invalid")
		}
		advKey = append([]byte(nil), advKeyCell.Bytes...)
	} else if advKeyCell.Kind != "null" {
		return empty, errors.New("whatsapp projection ADV capability is inconsistent")
	}
	details, err := requiredBytes("adv_details", 0)
	if err != nil {
		return empty, err
	}
	accountSignature, err := requiredBytes("adv_account_sig", 64)
	if err != nil {
		return empty, err
	}
	accountSignatureKey, err := requiredBytes("adv_account_sig_key", 32)
	if err != nil {
		return empty, err
	}
	deviceSignature, err := requiredBytes("adv_device_sig", 64)
	if err != nil {
		return empty, err
	}
	var identityArray [32]byte
	copy(identityArray[:], identityPrivate)
	device := &meowstore.Device{
		IdentityKey:        keys.NewKeyPairFromPrivateKey(identityArray),
		AdvSecretKey:       advKey,
		AdvSecretAvailable: advAvailable.Bool,
		FingerprintVersion: sqlstore.DeviceFingerprintVersion,
		Account: &waAdv.ADVSignedDeviceIdentity{
			Details:             append([]byte(nil), details...),
			AccountSignature:    append([]byte(nil), accountSignature...),
			AccountSignatureKey: append([]byte(nil), accountSignatureKey...),
			DeviceSignature:     append([]byte(nil), deviceSignature...),
		},
	}
	return sqlstore.CalculateDeviceFingerprint(device), nil
}

func validateStoredWhatsmeowDeviceKeyMaterial(
	ctx context.Context,
	tx *sql.Tx,
	sessionID string,
	revisionID int64,
) error {
	var noisePrivate, identityPrivate, signedPreKeyPrivate, signedPreKeySignature []byte
	if err := tx.QueryRowContext(ctx, `
		SELECT noise_key, identity_key, signed_pre_key, signed_pre_key_sig
		FROM whatsapp_device
		WHERE session_id=$1::uuid AND revision_id=$2
	`, sessionID, revisionID).Scan(
		&noisePrivate,
		&identityPrivate,
		&signedPreKeyPrivate,
		&signedPreKeySignature,
	); err != nil {
		return fmt.Errorf("read whatsmeow candidate key material: %w", err)
	}
	if err := sqlstore.ValidateCanonicalDeviceKeyMaterial(
		noisePrivate,
		identityPrivate,
		signedPreKeyPrivate,
		signedPreKeySignature,
	); err != nil {
		return fmt.Errorf("whatsmeow_candidate_key_material_invalid: %w", err)
	}
	return nil
}

func importedWhatsmeowNextPreKeyID(snapshot whatsmeowSessionSnapshot) (int64, error) {
	next := snapshot.NextPreKeyID
	if next == 0 {
		// Snapshot fixtures created before the allocator became explicit remain
		// readable, but a canonical projection always persists this counter.
		next = 1
	}
	if next < 1 || next > 1<<24 {
		return 0, errors.New("whatsapp prekey allocator is outside the supported range")
	}
	for _, table := range snapshot.Tables {
		if table.Name != "whatsapp_pre_keys" {
			continue
		}
		for _, row := range table.Rows {
			if len(row) == 0 || row[0].Kind != string(whatsmeowInt) {
				return 0, errors.New("whatsapp prekey ID is invalid")
			}
			keyID := row[0].Int
			if keyID < 0 || keyID >= 1<<24 {
				return 0, errors.New("whatsapp prekey ID is outside the supported range")
			}
			if keyID >= next {
				next = keyID + 1
			}
		}
		break
	}
	if next > 1<<24 {
		return 0, errors.New("whatsapp prekey allocator is exhausted")
	}
	return next, nil
}

func insertWhatsmeowSnapshot(
	ctx context.Context,
	tx *sql.Tx,
	sessionID string,
	revisionID int64,
	tables []whatsmeowPreparedTable,
) (int, error) {
	totalRows := 0
	for _, table := range tables {
		if _, ok := descriptorForWhatsmeowTable(table.Name); !ok {
			return 0, fmt.Errorf("unsupported whatsapp target table %q", table.Name)
		}
		columns := append([]string{"session_id", "revision_id"}, table.Columns...)
		for start := 0; start < len(table.Rows); start += whatsmeowImportBatchSize {
			end := min(start+whatsmeowImportBatchSize, len(table.Rows))
			args := make([]any, 0, (end-start)*len(columns))
			valueGroups := make([]string, 0, end-start)
			for _, row := range table.Rows[start:end] {
				if len(row) != len(table.Columns) {
					return 0, fmt.Errorf("invalid prepared %s row width", table.Name)
				}
				args = append(args, sessionID, revisionID)
				args = append(args, row...)
				placeholders := make([]string, len(columns))
				offset := len(args) - len(columns)
				for index := range placeholders {
					placeholders[index] = "$" + strconv.Itoa(offset+index+1)
				}
				valueGroups = append(valueGroups, "("+strings.Join(placeholders, ",")+")")
			}
			query := fmt.Sprintf(
				"INSERT INTO %s (%s) VALUES %s",
				table.Name,
				strings.Join(columns, ","),
				strings.Join(valueGroups, ","),
			)
			if _, err := tx.ExecContext(ctx, query, args...); err != nil {
				return 0, fmt.Errorf("import %s: %w", table.Name, err)
			}
			totalRows += end - start
		}
	}
	return totalRows, nil
}

func checksumWhatsmeowPreparedProjection(tables []whatsmeowPreparedTable) (string, int64, error) {
	hasher := sha256.New()
	var size int64
	writeBytes := func(value []byte) {
		var length [8]byte
		binary.BigEndian.PutUint64(length[:], uint64(len(value)))
		_, _ = hasher.Write(length[:])
		_, _ = hasher.Write(value)
		size += int64(len(length) + len(value))
	}
	writeString := func(value string) { writeBytes([]byte(value)) }

	for _, table := range tables {
		writeString(table.Name)
		for _, column := range table.Columns {
			writeString(column)
		}
		for _, row := range table.Rows {
			for _, value := range row {
				switch typed := value.(type) {
				case nil:
					writeBytes([]byte{0})
				case string:
					writeBytes(append([]byte{1}, []byte(typed)...))
				case []byte:
					writeBytes(append([]byte{2}, typed...))
				case int64:
					var encoded [9]byte
					encoded[0] = 3
					binary.BigEndian.PutUint64(encoded[1:], uint64(typed))
					writeBytes(encoded[:])
				case bool:
					encoded := byte(0)
					if typed {
						encoded = 1
					}
					writeBytes([]byte{4, encoded})
				default:
					return "", 0, fmt.Errorf("unsupported whatsapp projection value %T", value)
				}
			}
		}
	}
	return hex.EncodeToString(hasher.Sum(nil)), size, nil
}

func preparedWhatsmeowDeviceIdentity(tables []whatsmeowPreparedTable) (string, []byte, int64, error) {
	for _, table := range tables {
		if table.Name != "whatsapp_device" || len(table.Rows) != 1 {
			continue
		}
		row := table.Rows[0]
		if len(row) != len(table.Columns) {
			return "", nil, 0, errors.New("prepared whatsapp device row width is invalid")
		}
		values := make(map[string]any, len(table.Columns))
		for index, column := range table.Columns {
			values[column] = row[index]
		}
		jid, jidOK := values["jid"].(string)
		fingerprint, fingerprintOK := values["device_fingerprint"].([]byte)
		fingerprintVersion, versionOK := values["fingerprint_version"].(string)
		nextPreKeyID, counterOK := values["next_pre_key_id"].(int64)
		if !jidOK || jid == "" || !fingerprintOK || len(fingerprint) != sha256.Size ||
			!versionOK || fingerprintVersion != sqlstore.DeviceFingerprintVersion ||
			!counterOK || nextPreKeyID < 1 || nextPreKeyID > 1<<24 {
			return "", nil, 0, errors.New("prepared whatsapp device identity is incomplete")
		}
		return jid, append([]byte(nil), fingerprint...), nextPreKeyID, nil
	}
	return "", nil, 0, errors.New("prepared whatsapp projection has no device")
}

func preparedWhatsmeowTransportRoutingInfo(tables []whatsmeowPreparedTable) ([]byte, bool, error) {
	for _, table := range tables {
		if table.Name != whatsmeowTransportTable.Name {
			continue
		}
		if len(table.Rows) == 0 {
			return nil, false, nil
		} else if len(table.Rows) != 1 || len(table.Rows[0]) != len(table.Columns) {
			return nil, false, errors.New("prepared whatsapp transport projection is invalid")
		}
		values := make(map[string]any, len(table.Columns))
		for index, column := range table.Columns {
			values[column] = table.Rows[0][index]
		}
		namespace, namespaceOK := values["namespace"].(string)
		recordKey, recordKeyOK := values["record_key"].(string)
		codecVersion, codecOK := values["codec_version"].(int64)
		payload, payloadOK := values["payload"].([]byte)
		if !namespaceOK || namespace != meowstore.WhatsAppTransportNamespace ||
			!recordKeyOK || recordKey != meowstore.WhatsAppTransportRoutingInfoKey ||
			!codecOK || codecVersion != meowstore.WhatsAppTransportCodecVersion ||
			!payloadOK || meowstore.ValidateWhatsAppTransportRoutingInfo(payload) != nil {
			return nil, false, errors.New("prepared whatsapp transport routing record is invalid")
		}
		return append([]byte(nil), payload...), true, nil
	}
	return nil, false, nil
}

// whatsmeowFence turns the in-memory lease into the exact credentials expected
// by the database SECURITY DEFINER functions. It deliberately does not open a
// dedicated connection: every operation is a short transaction and remains
// valid through PgBouncer transaction pooling.
func (p *WorkerPostgres) whatsmeowFence(cfg Config) (whatsmeowOperationFence, error) {
	if p == nil || p.DB == nil {
		return whatsmeowOperationFence{}, errors.New("worker database is unavailable")
	}
	if _, err := uuid.Parse(cfg.WorkerID); err != nil {
		return whatsmeowOperationFence{}, errors.New("whatsapp session ID is invalid")
	}
	ownerID, token, generation, epoch, capability, err := p.SessionOperationFence()
	if err != nil {
		return whatsmeowOperationFence{}, err
	}
	if _, err := uuid.Parse(ownerID); err != nil {
		return whatsmeowOperationFence{}, errors.New("whatsapp lease owner is invalid")
	}
	return whatsmeowOperationFence{
		OwnerID: ownerID, FencingToken: token, Generation: generation,
		Epoch: epoch, Capability: capability,
	}, nil
}

func beginWhatsmeowSessionOperation(
	ctx context.Context,
	tx *sql.Tx,
	sessionID string,
	revisionID int64,
	fence whatsmeowOperationFence,
) error {
	if tx == nil || revisionID <= 0 {
		return errors.New("whatsapp session operation scope is invalid")
	}
	var accepted bool
	err := tx.QueryRowContext(ctx, `
		SELECT begin_whatsapp_session_operation(
			$1::uuid, $2, $3::uuid, $4, $5, $6::uuid, $7
		)
	`, sessionID, revisionID, fence.OwnerID, fence.FencingToken,
		fence.Generation, fence.Epoch, fence.Capability).Scan(&accepted)
	if err != nil {
		return fmt.Errorf("begin whatsapp session operation: %w", err)
	}
	if !accepted {
		return errors.New("whatsapp session operation was fenced")
	}
	return nil
}

func beginWhatsmeowSessionMutation(
	ctx context.Context,
	tx *sql.Tx,
	sessionID string,
	revisionID int64,
	fence whatsmeowOperationFence,
) error {
	if tx == nil || revisionID <= 0 {
		return errors.New("whatsapp session mutation scope is invalid")
	}
	var accepted bool
	err := tx.QueryRowContext(ctx, `
		SELECT begin_whatsapp_session_mutation(
			$1::uuid, $2, $3::uuid, $4, $5, $6::uuid, $7
		)
	`, sessionID, revisionID, fence.OwnerID, fence.FencingToken,
		fence.Generation, fence.Epoch, fence.Capability).Scan(&accepted)
	if err != nil {
		return fmt.Errorf("begin whatsapp session mutation: %w", err)
	}
	if !accepted {
		return errors.New("whatsapp session mutation was fenced")
	}
	return nil
}

func (p *WorkerPostgres) beginWhatsmeowSessionLifecycle(
	ctx context.Context,
	tx *sql.Tx,
	workerID string,
	accountID string,
) error {
	if p == nil || tx == nil {
		return errors.New("whatsapp session lifecycle scope is invalid")
	}
	p.operationScopeMu.RLock()
	var scope workerOperationScope
	if p.operationScope != nil {
		scope = *p.operationScope
	}
	p.operationScopeMu.RUnlock()
	if scope.workerID == "" || scope.accountID == "" ||
		!strings.EqualFold(strings.TrimSpace(workerID), scope.workerID) ||
		!strings.EqualFold(strings.TrimSpace(accountID), scope.accountID) {
		return errors.New("whatsapp session lifecycle scope rejected")
	}
	var accepted bool
	err := tx.QueryRowContext(ctx, `
		SELECT begin_whatsapp_session_lifecycle(
			$1::uuid, $2::uuid, $3, $4, $5::uuid, $6, $7
		)
	`, scope.workerID, scope.accountID, scope.provider, scope.generation,
		scope.writerEpoch, scope.capability, scope.container).Scan(&accepted)
	if err != nil {
		return fmt.Errorf("begin whatsapp session lifecycle: %w", err)
	}
	if !accepted {
		return errors.New("whatsapp session lifecycle was fenced")
	}
	return nil
}

func (p *WorkerPostgres) withWhatsmeowSessionOperation(
	ctx context.Context,
	cfg Config,
	revisionID int64,
	fn func(*sql.Tx, whatsmeowOperationFence) error,
) error {
	fence, err := p.whatsmeowFence(cfg)
	if err != nil {
		return err
	}
	tx, err := p.DB.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := beginWhatsmeowSessionOperation(ctx, tx, cfg.WorkerID, revisionID, fence); err != nil {
		return err
	}
	if err := fn(tx, fence); err != nil {
		return err
	}
	return tx.Commit()
}

func (p *WorkerPostgres) withWhatsmeowSessionMutation(
	ctx context.Context,
	cfg Config,
	revisionID int64,
	fn func(*sql.Tx, whatsmeowOperationFence) error,
) error {
	fence, err := p.whatsmeowFence(cfg)
	if err != nil {
		return err
	}
	tx, err := p.DB.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := beginWhatsmeowSessionMutation(ctx, tx, cfg.WorkerID, revisionID, fence); err != nil {
		return err
	}
	if err := fn(tx, fence); err != nil {
		return err
	}
	return tx.Commit()
}

// Promotion and rollback acquire the worker row before entering the session
// mutation guard. They must therefore run in a fresh transaction with no
// outer operation/mutation scope, otherwise the lock order would become
// session -> worker and could deadlock against the control plane.
func (p *WorkerPostgres) withWhatsmeowSessionLifecycle(
	ctx context.Context,
	cfg Config,
	fn func(*sql.Tx, whatsmeowOperationFence) error,
) error {
	fence, err := p.whatsmeowFence(cfg)
	if err != nil {
		return err
	}
	tx, err := p.DB.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := fn(tx, fence); err != nil {
		return err
	}
	return tx.Commit()
}

// hydrateWhatsmeowProviderHandoff copies the portable normalized projection
// from the fenced source revision into an already-created WhatsMeow candidate.
// Source reads and target writes intentionally use separate transactions so
// the read-only source scope cannot leak into candidate DML.
func (p *WorkerPostgres) hydrateWhatsmeowProviderHandoff(
	ctx context.Context,
	cfg Config,
	targetRevision int64,
	handoffID string,
) (resultStage whatsmeowImportStage, resultErr error) {
	failureCode := safeCodeHandoffInputFailed
	defer func() {
		resultErr = wrapSafeOperationalError(failureCode, resultErr)
	}()
	if targetRevision <= 0 {
		return whatsmeowImportStage{}, errors.New("whatsapp handoff target revision is invalid")
	}
	if _, err := uuid.Parse(handoffID); err != nil {
		return whatsmeowImportStage{}, errors.New("whatsapp handoff ID is invalid")
	}
	failureCode = safeCodeHandoffSourceScopeFailed
	fence, err := p.whatsmeowFence(cfg)
	if err != nil {
		return whatsmeowImportStage{}, err
	}
	logWhatsappSessionDebug(cfg.WhatsappSessionDebugEnabled, "handoff_hydration_started", map[string]any{
		"session_id":    cfg.WorkerID,
		"provider":      "whatsmeow",
		"revision":      targetRevision,
		"generation":    fence.Generation,
		"fencing_token": fence.FencingToken,
		"stage":         "source_read",
	})

	readTx, err := p.DB.BeginTx(ctx, &sql.TxOptions{
		Isolation: sql.LevelRepeatableRead,
		ReadOnly:  true,
	})
	if err != nil {
		return whatsmeowImportStage{}, err
	}
	defer readTx.Rollback()

	var sourceScope whatsmeowHandoffSourceScope
	if err := readTx.QueryRowContext(ctx, `
		SELECT source_provider, source_revision_id, target_provider,
			target_revision_id, handoff_id::text
		FROM begin_whatsapp_handoff_source_read(
			$1::uuid, $2, $3::uuid, $4, $5, $6::uuid, $7, $8
		)
	`, cfg.WorkerID, targetRevision, fence.OwnerID, fence.FencingToken,
		fence.Generation, fence.Epoch, fence.Capability, "whatsmeow").Scan(
		&sourceScope.SourceProvider,
		&sourceScope.SourceRevision,
		&sourceScope.TargetProvider,
		&sourceScope.TargetRevision,
		&sourceScope.HandoffID,
	); err != nil {
		return whatsmeowImportStage{}, fmt.Errorf("begin whatsapp handoff source read: %w", err)
	}
	if sourceScope.TargetProvider != "whatsmeow" ||
		sourceScope.TargetRevision != targetRevision ||
		sourceScope.HandoffID != handoffID ||
		sourceScope.SourceRevision <= 0 ||
		sourceScope.SourceRevision == targetRevision ||
		(sourceScope.SourceProvider != "baileys" && sourceScope.SourceProvider != "wwebjs") {
		return whatsmeowImportStage{}, errors.New("whatsapp handoff source scope is inconsistent")
	}
	if err := readTx.QueryRowContext(ctx, `
		SELECT lifecycle_operation_id::text
		FROM whatsapp_session_handoff
		WHERE session_id=$1::uuid AND handoff_id=$2::uuid
		  AND source_revision_id=$3 AND target_revision_id=$4
		  AND source_provider=$5 AND target_provider='whatsmeow'
		  AND state IN ('requested', 'draining', 'transforming')
	`, cfg.WorkerID, sourceScope.HandoffID, sourceScope.SourceRevision,
		sourceScope.TargetRevision, sourceScope.SourceProvider).Scan(
		&sourceScope.LifecycleOperationID,
	); err != nil {
		return whatsmeowImportStage{}, fmt.Errorf(
			"read whatsapp handoff source lineage: %w", err,
		)
	}
	if !isNonNilWhatsmeowUUID(sourceScope.LifecycleOperationID) {
		return whatsmeowImportStage{}, errors.New(
			"whatsapp handoff lifecycle operation is invalid",
		)
	}
	failureCode = safeCodeHandoffSourceCompatibilityFailed
	var sourceStatus string
	var sourceSchemaVersion, sourceCodecVersion int
	if err := readTx.QueryRowContext(ctx, `
		SELECT status, schema_version, codec_version
		FROM whatsapp_session_revision
		WHERE session_id=$1::uuid AND revision_id=$2
	`, cfg.WorkerID, sourceScope.SourceRevision).Scan(
		&sourceStatus, &sourceSchemaVersion, &sourceCodecVersion,
	); err != nil {
		return whatsmeowImportStage{}, fmt.Errorf("read whatsapp handoff source revision: %w", err)
	}
	if sourceStatus != "active" || sourceSchemaVersion != sqlstore.SharedSchemaVersion || sourceCodecVersion != 1 {
		return whatsmeowImportStage{}, fmt.Errorf(
			"incompatible whatsapp handoff source revision: status=%s schema=%d codec=%d",
			sourceStatus, sourceSchemaVersion, sourceCodecVersion,
		)
	}
	// WWeb's ML-KEM keys are held by private browser stores and are not part of
	// the classical Go libsignal model used by WhatsMeow. Validate the source's
	// authenticated canonical metadata before the generic snapshot filter can
	// discard its pq-scoped sessions. Older/unknown metadata fails closed.
	appStateResyncRequirement, err := inspectWhatsmeowHandoffSourceCompatibility(
		ctx,
		readTx,
		cfg.WorkerID,
		sourceScope.SourceRevision,
		sourceScope.SourceProvider,
		sourceScope.HandoffID,
		sourceScope.LifecycleOperationID,
	)
	if err != nil {
		return whatsmeowImportStage{}, err
	}
	var sourceAppStateSyncKeys whatsmeowAppStateSyncKeyAnchorProof
	if sourceScope.SourceProvider == "wwebjs" {
		sourceAppStateSyncKeys, err = captureWhatsmeowAppStateSyncKeyAnchorProof(
			ctx, readTx, cfg.WorkerID, sourceScope.SourceRevision,
		)
		if err != nil {
			return whatsmeowImportStage{}, fmt.Errorf(
				"capture wwebjs app-state sync-key proof: %w", err,
			)
		}
		if err := validateWhatsmeowAppStateSnapshotResyncSource(
			ctx, readTx, cfg.WorkerID, sourceScope.SourceRevision,
			appStateResyncRequirement,
		); err != nil {
			return whatsmeowImportStage{}, err
		}
	}
	failureCode = safeCodeHandoffSourceSnapshotFailed
	preflightRows, preflightBytes, err := preflightWhatsmeowSnapshotBoundsForSourceProvider(
		ctx, readTx, cfg.WorkerID, sourceScope.SourceRevision, sourceScope.SourceProvider,
	)
	if err != nil {
		return whatsmeowImportStage{}, err
	}
	logWhatsappSessionDebug(cfg.WhatsappSessionDebugEnabled, "handoff_source_preflight_completed", map[string]any{
		"session_id":        cfg.WorkerID,
		"provider":          "whatsmeow",
		"source_provider":   sourceScope.SourceProvider,
		"previous_revision": sourceScope.SourceRevision,
		"revision":          targetRevision,
		"rows":              preflightRows,
		"bytes":             preflightBytes,
		"stage":             "source_preflight",
	})

	var sourceJID string
	var sourceNextPreKeyID int64
	var sourceFingerprint []byte
	var sourceFingerprintVersion string
	if err := readTx.QueryRowContext(ctx, `
		SELECT jid, next_pre_key_id, device_fingerprint, fingerprint_version
		FROM whatsapp_device
		WHERE session_id=$1::uuid AND revision_id=$2
		  AND jid IS NOT NULL
	`, cfg.WorkerID, sourceScope.SourceRevision).Scan(
		&sourceJID, &sourceNextPreKeyID, &sourceFingerprint,
		&sourceFingerprintVersion,
	); err != nil {
		return whatsmeowImportStage{}, fmt.Errorf("read whatsapp handoff source device: %w", err)
	}
	if len(sourceFingerprint) != sha256.Size {
		return whatsmeowImportStage{}, errors.New("whatsapp handoff source fingerprint is incomplete")
	}
	if sourceFingerprintVersion != sqlstore.DeviceFingerprintVersion {
		return whatsmeowImportStage{}, errors.New("whatsapp handoff source fingerprint version is unsupported")
	}
	snapshot, err := captureWhatsmeowSnapshotForSourceProvider(
		ctx,
		readTx,
		cfg.WorkerID,
		sourceScope.SourceRevision,
		sourceJID,
		sourceNextPreKeyID,
		sourceScope.SourceProvider,
	)
	if err != nil {
		return whatsmeowImportStage{}, fmt.Errorf("capture whatsapp handoff source: %w", err)
	}
	snapshot.DeviceFingerprint = append([]byte(nil), sourceFingerprint...)
	snapshot.FingerprintVersion = sourceFingerprintVersion
	if err := readTx.Commit(); err != nil {
		return whatsmeowImportStage{}, err
	}

	// CPU-only codec validation and hashing happen after the immutable source
	// snapshot is committed, so no database transaction is held open for them.
	failureCode = safeCodeHandoffProjectionConversionFailed
	prepared, err := prepareWhatsmeowSnapshot(snapshot)
	if err != nil {
		return whatsmeowImportStage{}, fmt.Errorf("convert whatsapp handoff projection: %w", err)
	}
	checksum, projectionSize, err := checksumWhatsmeowPreparedProjection(prepared)
	if err != nil {
		return whatsmeowImportStage{}, err
	}
	expectedJID, expectedFingerprint, expectedNextPreKeyID, err := preparedWhatsmeowDeviceIdentity(prepared)
	if err != nil {
		return whatsmeowImportStage{}, err
	}
	expectedRoutingInfo, expectedHasRoutingInfo, err := preparedWhatsmeowTransportRoutingInfo(prepared)
	if err != nil {
		return whatsmeowImportStage{}, err
	}
	if expectedJID != sourceJID || !equalBytes(expectedFingerprint, sourceFingerprint) {
		return whatsmeowImportStage{}, errors.New("whatsapp handoff source identity fingerprint diverged")
	}

	failureCode = safeCodeHandoffTargetScopeFailed
	writeTx, err := p.DB.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return whatsmeowImportStage{}, err
	}
	defer writeTx.Rollback()
	if err := beginWhatsmeowSessionMutation(ctx, writeTx, cfg.WorkerID, targetRevision, fence); err != nil {
		return whatsmeowImportStage{}, err
	}

	var revisionStatus, revisionSource string
	var targetSchemaVersion, targetCodecVersion int
	if err := writeTx.QueryRowContext(ctx, `
		SELECT status, source, schema_version, codec_version
		FROM whatsapp_session_revision
		WHERE session_id=$1::uuid AND revision_id=$2
		  AND provider='whatsmeow'
	`, cfg.WorkerID, targetRevision).Scan(
		&revisionStatus, &revisionSource, &targetSchemaVersion, &targetCodecVersion,
	); err != nil {
		return whatsmeowImportStage{}, fmt.Errorf("read whatsapp handoff target revision: %w", err)
	}
	if revisionSource != "handoff" ||
		targetSchemaVersion != sqlstore.SharedSchemaVersion || targetCodecVersion != 1 ||
		(revisionStatus != "staging" && revisionStatus != "validating") {
		return whatsmeowImportStage{}, errors.New("whatsapp handoff target revision is not hydratable")
	}

	var targetDeviceCount int
	if err := writeTx.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM whatsapp_device
		WHERE session_id=$1::uuid AND revision_id=$2
	`, cfg.WorkerID, targetRevision).Scan(&targetDeviceCount); err != nil {
		return whatsmeowImportStage{}, err
	}
	rowCount := 0
	failureCode = safeCodeHandoffTargetImportFailed
	if targetDeviceCount == 0 {
		if revisionStatus != "staging" {
			return whatsmeowImportStage{}, errors.New("validated whatsapp handoff candidate has no device")
		}
		rowCount, err = insertWhatsmeowSnapshot(ctx, writeTx, cfg.WorkerID, targetRevision, prepared)
		if err != nil {
			return whatsmeowImportStage{}, err
		}
	} else {
		if targetDeviceCount != 1 || revisionStatus != "validating" {
			return whatsmeowImportStage{}, errors.New("whatsapp handoff candidate is partially hydrated")
		}
		var actualJID string
		var actualFingerprint []byte
		var actualFingerprintVersion string
		var actualNextPreKeyID int64
		if err := writeTx.QueryRowContext(ctx, `
			SELECT jid, device_fingerprint, fingerprint_version, next_pre_key_id
			FROM whatsapp_device
			WHERE session_id=$1::uuid AND revision_id=$2
		`, cfg.WorkerID, targetRevision).Scan(
			&actualJID, &actualFingerprint, &actualFingerprintVersion,
			&actualNextPreKeyID,
		); err != nil {
			return whatsmeowImportStage{}, err
		}
		if actualJID != expectedJID ||
			!equalBytes(actualFingerprint, expectedFingerprint) ||
			actualFingerprintVersion != sqlstore.DeviceFingerprintVersion ||
			actualNextPreKeyID != expectedNextPreKeyID {
			return whatsmeowImportStage{}, errors.New("whatsapp handoff candidate identity diverged on retry")
		}
		var actualRoutingCodec int64
		var actualRoutingInfo []byte
		routingErr := writeTx.QueryRowContext(ctx, `
			SELECT codec_version, payload
			FROM whatsapp_provider_record
			WHERE session_id=$1::uuid AND revision_id=$2
			  AND namespace=$3 AND record_key=$4
		`, cfg.WorkerID, targetRevision,
			meowstore.WhatsAppTransportNamespace,
			meowstore.WhatsAppTransportRoutingInfoKey,
		).Scan(&actualRoutingCodec, &actualRoutingInfo)
		if errors.Is(routingErr, sql.ErrNoRows) {
			if expectedHasRoutingInfo {
				return whatsmeowImportStage{}, errors.New("whatsapp handoff candidate routing info is missing on retry")
			}
		} else if routingErr != nil {
			return whatsmeowImportStage{}, routingErr
		} else if !expectedHasRoutingInfo ||
			actualRoutingCodec != meowstore.WhatsAppTransportCodecVersion ||
			meowstore.ValidateWhatsAppTransportRoutingInfo(actualRoutingInfo) != nil ||
			!equalBytes(actualRoutingInfo, expectedRoutingInfo) {
			return whatsmeowImportStage{}, errors.New("whatsapp handoff candidate routing info diverged on retry")
		}
	}
	appStateResyncGate := whatsmeowAppStateSnapshotResyncGate{Ready: true}
	if sourceScope.SourceProvider == "wwebjs" {
		failureCode = safeCodeHandoffTargetResyncGateFailed
		appStateResyncGate, err = ensureWhatsmeowAppStateSnapshotResyncGate(
			ctx, writeTx, cfg.WorkerID, sourceScope,
			appStateResyncRequirement, sourceAppStateSyncKeys,
		)
		if err != nil {
			return whatsmeowImportStage{}, err
		}
	}

	failureCode = safeCodeHandoffTargetFinalizeFailed
	result, err := writeTx.ExecContext(ctx, `
		UPDATE whatsapp_session_revision
		SET status='validating', checksum_sha256=$3, size_bytes=$4,
			persisted_at=COALESCE(persisted_at, clock_timestamp()),
			validated_at=COALESCE(validated_at, clock_timestamp())
		WHERE session_id=$1::uuid AND revision_id=$2
		  AND provider='whatsmeow' AND source='handoff'
		  AND (
			status='staging'
			OR (status='validating' AND checksum_sha256=$3)
		  )
	`, cfg.WorkerID, targetRevision, checksum, projectionSize)
	if err != nil {
		return whatsmeowImportStage{}, err
	}
	if affected, _ := result.RowsAffected(); affected != 1 {
		return whatsmeowImportStage{}, errors.New("whatsapp handoff target metadata diverged")
	}
	result, err = writeTx.ExecContext(ctx, `
		UPDATE whatsapp_session_handoff
		SET state=CASE WHEN state='promoting' THEN state ELSE 'validating' END,
			updated_at=clock_timestamp()
		WHERE session_id=$1::uuid AND handoff_id=$2::uuid
		  AND source_provider=$3 AND target_provider='whatsmeow'
		  AND source_revision_id=$4 AND target_revision_id=$5
		  AND state IN (
			'requested', 'draining', 'transforming', 'hydrating',
			'validating', 'promoting'
		  )
	`, cfg.WorkerID, handoffID, sourceScope.SourceProvider,
		sourceScope.SourceRevision, targetRevision)
	if err != nil {
		return whatsmeowImportStage{}, err
	}
	if affected, _ := result.RowsAffected(); affected != 1 {
		return whatsmeowImportStage{}, errors.New("whatsapp handoff association changed during hydration")
	}
	if err := writeTx.Commit(); err != nil {
		return whatsmeowImportStage{}, err
	}

	stage := whatsmeowImportStage{
		CandidateRevision:              targetRevision,
		PreviousRevision:               sourceScope.SourceRevision,
		HandoffID:                      handoffID,
		ExpectedJID:                    expectedJID,
		AppStateSnapshotResyncRequired: appStateResyncRequirement.Required,
		AppStateSnapshotResyncPending: sourceScope.SourceProvider == "wwebjs" &&
			appStateResyncRequirement.Required && !appStateResyncGate.Ready,
		AppStateSnapshotResyncArtifactID:  appStateResyncGate.ArtifactID,
		AppStateSnapshotResyncCollections: append([]string(nil), appStateResyncRequirement.Collections...),
	}
	logWhatsappSessionDebug(cfg.WhatsappSessionDebugEnabled, "handoff_hydrated", map[string]any{
		"session_id":                         cfg.WorkerID,
		"provider":                           "whatsmeow",
		"source_provider":                    sourceScope.SourceProvider,
		"revision":                           targetRevision,
		"previous_revision":                  sourceScope.SourceRevision,
		"generation":                         fence.Generation,
		"fencing_token":                      fence.FencingToken,
		"rows":                               rowCount,
		"bytes":                              projectionSize,
		"stage":                              "validating",
		"app_state_snapshot_resync_required": appStateResyncRequirement.Required,
		"app_state_snapshot_resync_pending":  stage.AppStateSnapshotResyncPending,
		"app_state_snapshot_resync_collection_count": len(appStateResyncRequirement.Collections),
		"app_state_snapshot_resync_collection_ids":   whatsmeowOpaqueAppStateCollectionIDs(appStateResyncRequirement.Collections),
		"app_state_sync_key_count":                   sourceAppStateSyncKeys.Count,
	})
	return stage, nil
}

func (p *WorkerPostgres) rollbackWhatsmeowProviderHandoffCandidate(
	ctx context.Context,
	cfg Config,
	targetRevision int64,
	handoffID string,
	errorCode string,
) error {
	if targetRevision <= 0 {
		return errors.New("whatsapp handoff target revision is invalid")
	}
	if _, err := uuid.Parse(handoffID); err != nil {
		return errors.New("whatsapp handoff ID is invalid")
	}
	if _, allowed := safeOperationalCodes[errorCode]; !allowed ||
		!strings.HasPrefix(errorCode, "whatsapp_whatsmeow_handoff_") {
		errorCode = safeCodeHandoffUnknownFailed
	}
	var sourceRevision int64
	var sourceProvider string
	if err := p.withWhatsmeowSessionOperation(ctx, cfg, targetRevision, func(tx *sql.Tx, _ whatsmeowOperationFence) error {
		if err := tx.QueryRowContext(ctx, `
			SELECT source_revision_id, source_provider
			FROM whatsapp_session_handoff
			WHERE session_id=$1::uuid AND handoff_id=$2::uuid
			  AND target_provider='whatsmeow' AND target_revision_id=$3
			  AND state IN (
				'requested', 'draining', 'transforming', 'hydrating',
				'validating', 'promoting'
			  )
		`, cfg.WorkerID, handoffID, targetRevision).Scan(
			&sourceRevision, &sourceProvider,
		); err != nil {
			return fmt.Errorf("read whatsapp handoff rollback scope: %w", err)
		}
		if sourceRevision <= 0 || sourceRevision == targetRevision ||
			(sourceProvider != "baileys" && sourceProvider != "wwebjs") {
			return errors.New("whatsapp handoff rollback scope is inconsistent")
		}
		return nil
	}); err != nil {
		return err
	}

	var lifecycleFence whatsmeowOperationFence
	if err := p.withWhatsmeowSessionLifecycle(ctx, cfg, func(tx *sql.Tx, fence whatsmeowOperationFence) error {
		lifecycleFence = fence
		var rolledBack bool
		if err := tx.QueryRowContext(ctx, `
			SELECT rollback_whatsapp_session_revision(
				$1::uuid, $2, $3, $4::uuid, $5, $6, $7::uuid, $8, $9
			)
		`, cfg.WorkerID, targetRevision, sourceRevision,
			fence.OwnerID, fence.FencingToken, fence.Generation,
			fence.Epoch, fence.Capability, errorCode).Scan(&rolledBack); err != nil {
			return fmt.Errorf("rollback whatsapp provider handoff candidate: %w", err)
		}
		if !rolledBack {
			return errors.New("whatsapp provider handoff candidate was not rolled back")
		}
		return nil
	}); err != nil {
		return err
	}
	logWhatsappSessionDebug(cfg.WhatsappSessionDebugEnabled, "handoff_rolled_back", map[string]any{
		"session_id":        cfg.WorkerID,
		"provider":          "whatsmeow",
		"source_provider":   sourceProvider,
		"revision":          targetRevision,
		"previous_revision": sourceRevision,
		"generation":        lifecycleFence.Generation,
		"fencing_token":     lifecycleFence.FencingToken,
		"stage":             "failed",
		"error_code":        errorCode,
	})
	return nil
}

func equalBytes(left, right []byte) bool {
	if len(left) != len(right) {
		return false
	}
	var difference byte
	for index := range left {
		difference |= left[index] ^ right[index]
	}
	return difference == 0
}

func (m *WhatsAppManager) rollbackActiveProviderHandoff(ctx context.Context, reason string) error {
	if m == nil || m.cfg.SessionStorage != SessionStoragePostgres ||
		!m.providerHandoffInProgress.Load() {
		return nil
	}
	stage := m.providerHandoffStage.Load()
	if stage == nil {
		return errors.New("whatsapp provider handoff is being finalized")
	}
	if !m.providerHandoffStage.CompareAndSwap(stage, nil) {
		return errors.New("whatsapp provider handoff state changed during rollback")
	}

	m.closeCurrentWhatsmeowClient()
	rollbackCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), workerDatabaseRecoveryTimeout)
	err := m.postgres.rollbackWhatsmeowProviderHandoffCandidate(
		rollbackCtx, m.cfg, stage.CandidateRevision, stage.HandoffID,
		safeWhatsmeowHandoffRuntimeRollbackCode(reason),
	)
	cancel()
	if err != nil {
		m.providerHandoffStage.CompareAndSwap(nil, stage)
		return fmt.Errorf("rollback whatsapp provider handoff after %s: %w", reason, err)
	}
	m.providerHandoffInProgress.Store(false)
	m.providerHandoffSnapshotResyncPending.Store(false)
	logWhatsappSessionDebug(m.cfg.WhatsappSessionDebugEnabled, "handoff_runtime_rolled_back", map[string]any{
		"session_id":        m.cfg.WorkerID,
		"provider":          "whatsmeow",
		"revision":          stage.CandidateRevision,
		"previous_revision": stage.PreviousRevision,
		"stage":             "rolled_back",
		"reason":            reason,
	})
	return nil
}

func (m *WhatsAppManager) rejectLoginDuringProviderHandoff(ctx context.Context, method string) error {
	if m == nil || !m.providerHandoffInProgress.Load() {
		return nil
	}
	if err := m.rollbackActiveProviderHandoff(ctx, "fresh_login_"+method); err != nil {
		return fmt.Errorf("reject %s during whatsapp provider handoff: %w", method, err)
	}
	return fmt.Errorf("%s is forbidden during whatsapp provider handoff; candidate was rolled back", method)
}

// AssertWhatsmeowSessionWriterFence performs a read-only fence assertion. It
// proves the current lease and revision without taking mutation locks.
func (p *WorkerPostgres) AssertWhatsmeowSessionWriterFence(ctx context.Context, cfg Config) error {
	revisionID, _, err := p.OpenSessionRevision(ctx, cfg)
	if err != nil {
		return err
	}
	return p.withWhatsmeowSessionOperation(ctx, cfg, revisionID, func(tx *sql.Tx, _ whatsmeowOperationFence) error {
		var provider string
		if err := tx.QueryRowContext(ctx, `
			SELECT provider FROM whatsapp_session
			WHERE session_id=$1::uuid
		`, cfg.WorkerID).Scan(&provider); err != nil {
			return fmt.Errorf("read whatsapp session fence: %w", err)
		}
		if provider != "whatsmeow" {
			return errors.New("whatsapp session provider fence mismatch")
		}
		return nil
	})
}

// MarkWhatsmeowSessionReady finalizes normal pairing and promotes a validated
// cross-provider handoff. A secure-import candidate remains owned by its
// synchronous import workflow, which performs additional request-level checks.
func (p *WorkerPostgres) MarkWhatsmeowSessionReady(ctx context.Context, cfg Config) error {
	opened, err := p.openSessionRevision(ctx, cfg)
	if err != nil {
		return err
	}
	revisionID := opened.RevisionID
	if opened.HandoffID.Valid {
		var revisionSource, sourceProvider string
		var sourceRevision, targetRevision int64
		var expectedJID string
		var sourceScope whatsmeowHandoffSourceScope
		if err := p.withWhatsmeowSessionOperation(ctx, cfg, revisionID, func(tx *sql.Tx, _ whatsmeowOperationFence) error {
			if err := validateStoredWhatsmeowDeviceKeyMaterial(ctx, tx, cfg.WorkerID, revisionID); err != nil {
				return err
			}
			if err := tx.QueryRowContext(ctx, `
				SELECT target.source, handoff.source_provider,
					handoff.source_revision_id, handoff.target_revision_id,
					device.jid, handoff.lifecycle_operation_id::text
				FROM whatsapp_session_handoff AS handoff
				JOIN whatsapp_session_revision AS target
				  ON target.session_id=handoff.session_id
				 AND target.revision_id=handoff.target_revision_id
				JOIN whatsapp_device AS device
				  ON device.session_id=target.session_id
				 AND device.revision_id=target.revision_id
				WHERE handoff.session_id=$1::uuid
				  AND handoff.handoff_id=$2::uuid
				  AND handoff.target_provider='whatsmeow'
				  AND handoff.state IN ('hydrating', 'validating', 'promoting')
			`, cfg.WorkerID, opened.HandoffID.String).Scan(
				&revisionSource, &sourceProvider, &sourceRevision,
				&targetRevision, &expectedJID,
				&sourceScope.LifecycleOperationID,
			); err != nil {
				return fmt.Errorf("read whatsapp readiness handoff: %w", err)
			}
			if targetRevision != revisionID || sourceRevision <= 0 ||
				sourceRevision == targetRevision || expectedJID == "" {
				return errors.New("whatsapp readiness handoff scope is inconsistent")
			}
			if revisionSource != "secure_import" && (revisionSource != "handoff" ||
				(sourceProvider != "baileys" && sourceProvider != "wwebjs")) {
				return errors.New("whatsapp readiness handoff source is unsupported")
			}
			sourceScope.SourceProvider = sourceProvider
			sourceScope.SourceRevision = sourceRevision
			sourceScope.TargetProvider = "whatsmeow"
			sourceScope.TargetRevision = targetRevision
			sourceScope.HandoffID = opened.HandoffID.String
			return nil
		}); err != nil {
			return err
		}
		if revisionSource == "secure_import" {
			logWhatsappSessionDebug(cfg.WhatsappSessionDebugEnabled, "checkpoint_deferred", map[string]any{
				"session_id": cfg.WorkerID,
				"provider":   "whatsmeow",
				"revision":   revisionID,
				"stage":      "secure_import",
			})
			return nil
		}

		var lifecycleFence whatsmeowOperationFence
		if err := p.withWhatsmeowSessionLifecycle(ctx, cfg, func(tx *sql.Tx, fence whatsmeowOperationFence) error {
			lifecycleFence = fence
			// The SECURITY DEFINER boundary proves the signed worker runtime scope
			// before taking the control-plane lock. The runtime role intentionally
			// has no direct worker-table privileges.
			if err := p.beginWhatsmeowSessionLifecycle(
				ctx, tx, cfg.WorkerID, cfg.AccountID,
			); err != nil {
				return err
			}
			if err := beginWhatsmeowSessionMutation(
				ctx, tx, cfg.WorkerID, targetRevision, fence,
			); err != nil {
				return err
			}
			if err := validateStoredWhatsmeowDeviceKeyMaterial(
				ctx, tx, cfg.WorkerID, targetRevision,
			); err != nil {
				return err
			}

			var currentRevisionSource, currentSourceProvider string
			var currentSourceRevision, currentTargetRevision int64
			var currentExpectedJID, currentLifecycleOperationID string
			if err := tx.QueryRowContext(ctx, `
				SELECT target.source, handoff.source_provider,
					handoff.source_revision_id, handoff.target_revision_id,
					device.jid, handoff.lifecycle_operation_id::text
				FROM whatsapp_session_handoff AS handoff
				JOIN whatsapp_session_revision AS target
				  ON target.session_id=handoff.session_id
				 AND target.revision_id=handoff.target_revision_id
				JOIN whatsapp_device AS device
				  ON device.session_id=target.session_id
				 AND device.revision_id=target.revision_id
				WHERE handoff.session_id=$1::uuid
				  AND handoff.handoff_id=$2::uuid
				  AND handoff.target_provider='whatsmeow'
				  AND handoff.state IN ('hydrating', 'validating', 'promoting')
				FOR UPDATE OF handoff
			`, cfg.WorkerID, opened.HandoffID.String).Scan(
				&currentRevisionSource, &currentSourceProvider,
				&currentSourceRevision, &currentTargetRevision,
				&currentExpectedJID, &currentLifecycleOperationID,
			); err != nil {
				return fmt.Errorf("revalidate whatsapp readiness handoff: %w", err)
			}
			if currentRevisionSource != revisionSource ||
				currentSourceProvider != sourceProvider ||
				currentSourceRevision != sourceRevision ||
				currentTargetRevision != targetRevision ||
				currentExpectedJID != expectedJID ||
				currentLifecycleOperationID != sourceScope.LifecycleOperationID {
				return errors.New("whatsapp readiness handoff changed before promotion")
			}
			if currentSourceProvider == "wwebjs" {
				currentSourceScope := whatsmeowHandoffSourceScope{
					SourceProvider:       currentSourceProvider,
					SourceRevision:       currentSourceRevision,
					TargetProvider:       "whatsmeow",
					TargetRevision:       currentTargetRevision,
					HandoffID:            opened.HandoffID.String,
					LifecycleOperationID: currentLifecycleOperationID,
				}
				if err := assertWhatsmeowAppStateSnapshotResyncGateReady(
					ctx, tx, cfg.WorkerID, currentSourceScope,
				); err != nil {
					return err
				}
			}
			var promoted bool
			if err := tx.QueryRowContext(ctx, `
				SELECT promote_whatsapp_session_revision(
					$1::uuid, $2, $3, $4::uuid, $5, $6, $7::uuid, $8, $9
				)
			`, cfg.WorkerID, sourceRevision, targetRevision,
				fence.OwnerID, fence.FencingToken, fence.Generation,
				fence.Epoch, fence.Capability, expectedJID).Scan(&promoted); err != nil {
				return fmt.Errorf("promote whatsapp provider handoff: %w", err)
			}
			if !promoted {
				return errors.New("whatsapp provider handoff was not promoted")
			}
			return nil
		}); err != nil {
			return err
		}
		logWhatsappSessionDebug(cfg.WhatsappSessionDebugEnabled, "handoff_promoted", map[string]any{
			"session_id":        cfg.WorkerID,
			"provider":          "whatsmeow",
			"source_provider":   sourceProvider,
			"revision":          targetRevision,
			"previous_revision": sourceRevision,
			"generation":        lifecycleFence.Generation,
			"fencing_token":     lifecycleFence.FencingToken,
			"stage":             "active",
		})
		return nil
	}

	return p.withWhatsmeowSessionMutation(ctx, cfg, revisionID, func(tx *sql.Tx, fence whatsmeowOperationFence) error {
		if err := validateStoredWhatsmeowDeviceKeyMaterial(ctx, tx, cfg.WorkerID, revisionID); err != nil {
			return err
		}
		var unexpectedHandoff bool
		if err := tx.QueryRowContext(ctx, `
			SELECT EXISTS (
				SELECT 1 FROM whatsapp_session_handoff
				WHERE session_id=$1::uuid AND target_revision_id=$2
				  AND state IN ('hydrating', 'validating', 'promoting')
			)
		`, cfg.WorkerID, revisionID).Scan(&unexpectedHandoff); err != nil {
			return err
		}
		if unexpectedHandoff {
			logWhatsappSessionDebug(cfg.WhatsappSessionDebugEnabled, "checkpoint_deferred", map[string]any{
				"session_id": cfg.WorkerID,
				"provider":   "whatsmeow",
				"revision":   revisionID,
				"stage":      "handoff_identity_missing",
			})
			return errors.New("whatsapp handoff identity was not returned by revision open")
		}
		var finalized bool
		query := `
			SELECT finalize_whatsapp_session_pairing(
				$1::uuid, $2, $3::uuid, $4, $5, $6::uuid, $7
			)
		`
		args := []any{cfg.WorkerID, revisionID, fence.OwnerID, fence.FencingToken,
			fence.Generation, fence.Epoch, fence.Capability}
		if cfg.SessionStorageMigrationID != "" {
			query = `
				SELECT promote_legacy_volume_migration_revision(
					$1::uuid, $2::uuid, $3, $4::uuid, $5, $6, $7::uuid, $8
				)
			`
			args = []any{cfg.SessionStorageMigrationID, cfg.WorkerID, revisionID,
				fence.OwnerID, fence.FencingToken, fence.Generation, fence.Epoch,
				fence.Capability}
		}
		if err := tx.QueryRowContext(ctx, query, args...).Scan(&finalized); err != nil {
			return fmt.Errorf("finalize whatsapp pairing revision: %w", err)
		}
		if !finalized {
			return errors.New("whatsapp pairing revision was not finalized")
		}
		logWhatsappSessionDebug(cfg.WhatsappSessionDebugEnabled, "checkpoint_ready", map[string]any{
			"session_id":    cfg.WorkerID,
			"provider":      "whatsmeow",
			"revision":      revisionID,
			"generation":    fence.Generation,
			"fencing_token": fence.FencingToken,
		})
		return nil
	})
}

// ClearWhatsmeowSession delegates cross-revision cleanup to the privileged
// canonical function after an exclusive mutation guard. Revision deletion
// cascades protocol rows without ever using JID as ownership.
func (p *WorkerPostgres) ClearWhatsmeowSession(ctx context.Context, cfg Config) error {
	revisionID, _, err := p.OpenSessionRevision(ctx, cfg)
	if err != nil {
		return err
	}
	return p.withWhatsmeowSessionMutation(ctx, cfg, revisionID, func(tx *sql.Tx, fence whatsmeowOperationFence) error {
		var cleared bool
		if err := tx.QueryRowContext(ctx, `
			SELECT clear_whatsapp_session(
				$1::uuid, $2::uuid, $3, $4, $5::uuid, $6
			)
		`, cfg.WorkerID, fence.OwnerID, fence.FencingToken,
			fence.Generation, fence.Epoch, fence.Capability).Scan(&cleared); err != nil {
			return fmt.Errorf("clear whatsapp session: %w", err)
		}
		if !cleared {
			return errors.New("whatsapp session clear was fenced")
		}
		logWhatsappSessionDebug(cfg.WhatsappSessionDebugEnabled, "session_cleared", map[string]any{
			"session_id":    cfg.WorkerID,
			"provider":      "whatsmeow",
			"revision":      revisionID,
			"generation":    fence.Generation,
			"fencing_token": fence.FencingToken,
		})
		return nil
	})
}

func (p *WorkerPostgres) stageWhatsmeowSecureImport(
	ctx context.Context,
	cfg Config,
	candidate whatsmeowSessionSnapshot,
	prepared []whatsmeowPreparedTable,
	source []byte,
) (whatsmeowImportStage, error) {
	if len(prepared) == 0 || candidate.JID == "" {
		return whatsmeowImportStage{}, errors.New("prepared whatsapp import projection is empty")
	}
	sourceChecksum := sha256.Sum256(source)
	checksumHex := hex.EncodeToString(sourceChecksum[:])
	activeRevision, _, err := p.OpenSessionRevision(ctx, cfg)
	if err != nil {
		return whatsmeowImportStage{}, err
	}
	fence, err := p.whatsmeowFence(cfg)
	if err != nil {
		return whatsmeowImportStage{}, err
	}
	tx, err := p.DB.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return whatsmeowImportStage{}, err
	}
	defer tx.Rollback()

	stage := whatsmeowImportStage{
		PreviousRevision: activeRevision,
		ExpectedJID:      candidate.JID,
	}
	if err := tx.QueryRowContext(ctx, `
		SELECT revision_id, handoff_id::text, source_revision_id
		FROM create_whatsapp_session_candidate(
			$1::uuid, $2, $3::uuid, 'whatsmeow', $4, $5, $6::uuid, $7,
			'secure_import', $8, $9, $10
		)
	`, cfg.WorkerID, activeRevision, fence.OwnerID, fence.FencingToken,
		fence.Generation, fence.Epoch, fence.Capability,
		sqlstore.SharedSchemaVersion, whatsappCanonicalCodecVersion,
		whatsappCanonicalFormat).Scan(
		&stage.CandidateRevision,
		&stage.HandoffID,
		&stage.PreviousRevision,
	); err != nil {
		return whatsmeowImportStage{}, fmt.Errorf("create whatsapp import candidate: %w", err)
	}
	if stage.CandidateRevision <= 0 || stage.PreviousRevision != activeRevision {
		return whatsmeowImportStage{}, errors.New("whatsapp import candidate association is invalid")
	}

	// Projection DML begins only after the candidate lease/fencing guard has
	// installed transaction-local session and revision scope.
	if err := beginWhatsmeowSessionMutation(ctx, tx, cfg.WorkerID, stage.CandidateRevision, fence); err != nil {
		return whatsmeowImportStage{}, err
	}
	rowCount, err := insertWhatsmeowSnapshot(ctx, tx, cfg.WorkerID, stage.CandidateRevision, prepared)
	if err != nil {
		return whatsmeowImportStage{}, err
	}
	result, err := tx.ExecContext(ctx, `
		UPDATE whatsapp_session_revision
		SET status='validating', checksum_sha256=$3, size_bytes=$4,
			persisted_at=clock_timestamp(), validated_at=clock_timestamp()
		WHERE session_id=$1::uuid AND revision_id=$2
		  AND provider='whatsmeow' AND source='secure_import'
		  AND status='staging'
	`, cfg.WorkerID, stage.CandidateRevision, checksumHex, len(source))
	if err != nil {
		return whatsmeowImportStage{}, err
	}
	if affected, _ := result.RowsAffected(); affected != 1 {
		return whatsmeowImportStage{}, errors.New("whatsapp import candidate metadata was fenced")
	}
	result, err = tx.ExecContext(ctx, `
		UPDATE whatsapp_session_handoff
		SET state='validating', updated_at=clock_timestamp()
		WHERE session_id=$1::uuid AND handoff_id=$2::uuid
		  AND source_revision_id=$3 AND target_revision_id=$4
		  AND state='hydrating'
	`, cfg.WorkerID, stage.HandoffID, stage.PreviousRevision, stage.CandidateRevision)
	if err != nil {
		return whatsmeowImportStage{}, err
	}
	if affected, _ := result.RowsAffected(); affected != 1 {
		return whatsmeowImportStage{}, errors.New("whatsapp import handoff association was fenced")
	}
	if err := tx.Commit(); err != nil {
		return whatsmeowImportStage{}, err
	}
	logWhatsappSessionDebug(cfg.WhatsappSessionDebugEnabled, "import_staged", map[string]any{
		"session_id":        cfg.WorkerID,
		"provider":          "whatsmeow",
		"revision":          stage.CandidateRevision,
		"previous_revision": stage.PreviousRevision,
		"generation":        fence.Generation,
		"fencing_token":     fence.FencingToken,
		"rows":              rowCount,
		"bytes":             len(source),
		"stage":             "validating",
	})
	return stage, nil
}

func (p *WorkerPostgres) promoteWhatsmeowSecureImport(ctx context.Context, cfg Config, stage whatsmeowImportStage) error {
	if stage.CandidateRevision <= 0 || stage.PreviousRevision <= 0 || stage.HandoffID == "" {
		return errors.New("whatsapp import stage is invalid")
	}
	alreadyPromoted := false
	if err := p.withWhatsmeowSessionOperation(ctx, cfg, stage.CandidateRevision, func(tx *sql.Tx, _ whatsmeowOperationFence) error {
		if err := validateStoredWhatsmeowDeviceKeyMaterial(ctx, tx, cfg.WorkerID, stage.CandidateRevision); err != nil {
			return err
		}
		var state string
		var activeRevision, previousRevision sql.NullInt64
		if err := tx.QueryRowContext(ctx, `
			SELECT state, active_revision_id, previous_revision_id
			FROM whatsapp_session
			WHERE session_id=$1::uuid
		`, cfg.WorkerID).Scan(&state, &activeRevision, &previousRevision); err != nil {
			return err
		}
		if state == "ready" && activeRevision.Valid &&
			activeRevision.Int64 == stage.CandidateRevision &&
			previousRevision.Valid && previousRevision.Int64 == stage.PreviousRevision {
			alreadyPromoted = true
			return nil
		}
		var associated bool
		if err := tx.QueryRowContext(ctx, `
			SELECT EXISTS (
				SELECT 1 FROM whatsapp_session_handoff
				WHERE session_id=$1::uuid AND handoff_id=$2::uuid
				  AND source_revision_id=$3 AND target_revision_id=$4
				  AND state IN ('hydrating', 'validating', 'promoting')
			)
		`, cfg.WorkerID, stage.HandoffID, stage.PreviousRevision,
			stage.CandidateRevision).Scan(&associated); err != nil {
			return err
		}
		if !associated {
			return errors.New("whatsapp import handoff association is stale")
		}
		return nil
	}); err != nil {
		return err
	}
	if alreadyPromoted {
		return nil
	}

	var lifecycleFence whatsmeowOperationFence
	if err := p.withWhatsmeowSessionLifecycle(ctx, cfg, func(tx *sql.Tx, fence whatsmeowOperationFence) error {
		lifecycleFence = fence
		var promoted bool
		if err := tx.QueryRowContext(ctx, `
			SELECT promote_whatsapp_session_revision(
				$1::uuid, $2, $3, $4::uuid, $5, $6, $7::uuid, $8, $9
			)
		`, cfg.WorkerID, stage.PreviousRevision, stage.CandidateRevision,
			fence.OwnerID, fence.FencingToken, fence.Generation, fence.Epoch,
			fence.Capability, stage.ExpectedJID).Scan(&promoted); err != nil {
			return fmt.Errorf("promote whatsapp import candidate: %w", err)
		}
		if !promoted {
			return errors.New("whatsapp import candidate was not promoted")
		}
		return nil
	}); err != nil {
		return err
	}
	logWhatsappSessionDebug(cfg.WhatsappSessionDebugEnabled, "import_promoted", map[string]any{
		"session_id":        cfg.WorkerID,
		"provider":          "whatsmeow",
		"revision":          stage.CandidateRevision,
		"previous_revision": stage.PreviousRevision,
		"generation":        lifecycleFence.Generation,
		"fencing_token":     lifecycleFence.FencingToken,
		"stage":             "active",
	})
	return nil
}

func (p *WorkerPostgres) rollbackWhatsmeowSecureImport(ctx context.Context, cfg Config, stage whatsmeowImportStage) error {
	if stage.CandidateRevision <= 0 || stage.PreviousRevision <= 0 || stage.HandoffID == "" {
		return errors.New("whatsapp import stage is invalid")
	}
	// Read validation is committed before the lifecycle transaction. The
	// rollback function revalidates everything while acquiring worker first,
	// then lease/session/revision, and restores the source header atomically.
	alreadyRolledBack := false
	if err := p.withWhatsmeowSessionOperation(ctx, cfg, stage.CandidateRevision, func(tx *sql.Tx, _ whatsmeowOperationFence) error {
		var state string
		var activeRevision, previousRevision sql.NullInt64
		if err := tx.QueryRowContext(ctx, `
			SELECT state, active_revision_id, previous_revision_id
			FROM whatsapp_session
			WHERE session_id=$1::uuid
		`, cfg.WorkerID).Scan(&state, &activeRevision, &previousRevision); err != nil {
			return err
		}
		if activeRevision.Valid && activeRevision.Int64 == stage.PreviousRevision &&
			!previousRevision.Valid && state != "handoff" {
			alreadyRolledBack = true
			return nil
		}
		var handoffState string
		if err := tx.QueryRowContext(ctx, `
			SELECT state FROM whatsapp_session_handoff
			WHERE session_id=$1::uuid AND handoff_id=$2::uuid
			  AND source_revision_id=$3 AND target_revision_id=$4
		`, cfg.WorkerID, stage.HandoffID, stage.PreviousRevision,
			stage.CandidateRevision).Scan(&handoffState); err != nil {
			return fmt.Errorf("read whatsapp import rollback association: %w", err)
		}
		if handoffState == "failed" && activeRevision.Valid &&
			activeRevision.Int64 == stage.PreviousRevision {
			alreadyRolledBack = true
			return nil
		}
		return nil
	}); err != nil {
		return err
	}
	if alreadyRolledBack {
		return nil
	}

	var lifecycleFence whatsmeowOperationFence
	if err := p.withWhatsmeowSessionLifecycle(ctx, cfg, func(tx *sql.Tx, fence whatsmeowOperationFence) error {
		lifecycleFence = fence
		var rolledBack bool
		if err := tx.QueryRowContext(ctx, `
			SELECT rollback_whatsapp_session_revision(
				$1::uuid, $2, $3, $4::uuid, $5, $6, $7::uuid, $8
			)
		`, cfg.WorkerID, stage.CandidateRevision, stage.PreviousRevision,
			fence.OwnerID, fence.FencingToken, fence.Generation,
			fence.Epoch, fence.Capability).Scan(&rolledBack); err != nil {
			return fmt.Errorf("rollback whatsapp import candidate: %w", err)
		}
		if !rolledBack {
			return errors.New("whatsapp import candidate was not rolled back")
		}
		return nil
	}); err != nil {
		return err
	}
	logWhatsappSessionDebug(cfg.WhatsappSessionDebugEnabled, "import_rolled_back", map[string]any{
		"session_id":        cfg.WorkerID,
		"provider":          "whatsmeow",
		"revision":          stage.CandidateRevision,
		"previous_revision": stage.PreviousRevision,
		"generation":        lifecycleFence.Generation,
		"fencing_token":     lifecycleFence.FencingToken,
		"stage":             "failed",
	})
	return nil
}
