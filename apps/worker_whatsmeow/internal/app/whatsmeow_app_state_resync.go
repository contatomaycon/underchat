package app

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"google.golang.org/protobuf/proto"
)

const (
	whatsmeowAppStateSnapshotResyncArtifactKind = "app_state_snapshot_resync_gate"
	whatsmeowAppStateSnapshotResyncGateVersion  = 1
	whatsmeowAppStateSnapshotResyncMinTimeout   = 90 * time.Second
	whatsmeowAppStateSnapshotResyncMaxTimeout   = 5 * time.Minute
)

var whatsmeowCanonicalAppStateCollections = []string{
	"critical_block",
	"critical_unblock_low",
	"regular",
	"regular_high",
	"regular_low",
}

type whatsmeowAppStateSnapshotResyncRequirement struct {
	Required    bool
	Collections []string
}

type whatsmeowAppStateSyncKeyProofEntry struct {
	KeyIDChecksumSHA256 string `json:"key_id_checksum_sha256"`
	RowChecksumSHA256   string `json:"row_checksum_sha256"`
	Epoch               int    `json:"epoch"`
	Timestamp           int64  `json:"timestamp"`
	FingerprintRawID    uint32 `json:"fingerprint_raw_id"`
}

type whatsmeowAppStateSyncKeyAnchorProof struct {
	Count            int                                  `json:"count"`
	MaxEpoch         int                                  `json:"max_epoch"`
	MaxTimestamp     int64                                `json:"max_timestamp"`
	FingerprintRawID uint32                               `json:"fingerprint_raw_id"`
	Keys             []whatsmeowAppStateSyncKeyProofEntry `json:"keys"`
}

type whatsmeowAppStateSyncKeyChainAnchor struct {
	Epoch     int
	Timestamp int64
}

type whatsmeowAppStateMaterializedCollection struct {
	Name    string `json:"name"`
	Version int64  `json:"version"`
}

type whatsmeowAppStateSnapshotResyncManifest struct {
	Version                           int                                       `json:"version"`
	HandoffID                         string                                    `json:"handoff_id"`
	LifecycleOperationID              string                                    `json:"lifecycle_operation_id"`
	SourceProvider                    string                                    `json:"source_provider"`
	SourceRevisionID                  int64                                     `json:"source_revision_id"`
	TargetProvider                    string                                    `json:"target_provider"`
	TargetRevisionID                  int64                                     `json:"target_revision_id"`
	AppStateSnapshotResyncRequired    bool                                      `json:"app_state_snapshot_resync_required"`
	AppStateSnapshotResyncCollections []string                                  `json:"app_state_snapshot_resync_collections"`
	SourceSyncKeys                    whatsmeowAppStateSyncKeyAnchorProof       `json:"source_sync_keys"`
	MaterializedCollections           []whatsmeowAppStateMaterializedCollection `json:"materialized_collections"`
}

type whatsmeowAppStateSnapshotResyncGate struct {
	ArtifactID string
	Ready      bool
}

type whatsmeowAppStateSnapshotResyncState struct {
	Versions   map[string]int64
	FutureMAC  bool
	TargetKeys whatsmeowAppStateSyncKeyAnchorProof
}

func whatsmeowAppStateSnapshotResyncRequirementFromCapabilities(
	capabilities whatsmeowWWebPQCapabilities,
) (whatsmeowAppStateSnapshotResyncRequirement, error) {
	if capabilities.AppStateSnapshotResyncRequired == nil ||
		capabilities.AppStateSnapshotResyncCollections == nil {
		return whatsmeowAppStateSnapshotResyncRequirement{}, errors.New(
			"whatsmeow_wwebjs_app_state_snapshot_resync_manifest_missing",
		)
	}
	required := *capabilities.AppStateSnapshotResyncRequired
	providedCollections := append(
		[]string(nil), (*capabilities.AppStateSnapshotResyncCollections)...,
	)
	collections, err := canonicalWhatsmeowAppStateSnapshotResyncCollections(
		providedCollections,
	)
	if err != nil || !equalStringSlices(providedCollections, collections) ||
		(required && len(collections) == 0) ||
		(!required && len(collections) != 0) {
		return whatsmeowAppStateSnapshotResyncRequirement{}, errors.New(
			"whatsmeow_wwebjs_app_state_snapshot_resync_manifest_invalid",
		)
	}
	return whatsmeowAppStateSnapshotResyncRequirement{
		Required: required, Collections: collections,
	}, nil
}

func canonicalWhatsmeowAppStateSnapshotResyncCollections(
	collections []string,
) ([]string, error) {
	known := make(map[string]struct{}, len(whatsmeowCanonicalAppStateCollections))
	for _, name := range whatsmeowCanonicalAppStateCollections {
		known[name] = struct{}{}
	}
	seen := make(map[string]struct{}, len(collections))
	canonical := append([]string(nil), collections...)
	for _, name := range canonical {
		if _, ok := known[name]; !ok {
			return nil, errors.New("unknown app-state collection")
		}
		if _, duplicate := seen[name]; duplicate {
			return nil, errors.New("duplicate app-state collection")
		}
		seen[name] = struct{}{}
	}
	sort.Strings(canonical)
	return canonical, nil
}

func whatsmeowOpaqueAppStateCollectionIDs(collections []string) []string {
	opaque := make([]string, 0, len(collections))
	for _, name := range collections {
		digest := sha256.Sum256([]byte("underchat:app-state-collection:v1\x00" + name))
		opaque = append(opaque, hex.EncodeToString(digest[:8]))
	}
	sort.Strings(opaque)
	return opaque
}

func whatsmeowAppStateSnapshotResyncArtifactID(handoffID string) (string, error) {
	namespace, err := uuid.Parse(handoffID)
	if err != nil || namespace == uuid.Nil {
		return "", errors.New("whatsapp handoff ID is invalid")
	}
	return uuid.NewSHA1(
		namespace,
		[]byte("underchat:whatsapp:app-state-snapshot-resync-gate:v1"),
	).String(), nil
}

func whatsmeowAppStateSyncKeyEpoch(keyID []byte) (int, error) {
	if len(keyID) < 2 {
		return 0, errors.New("app-state sync key ID is incomplete")
	}
	return int(binary.BigEndian.Uint16(keyID[len(keyID)-2:])), nil
}

func whatsmeowAppStateSyncKeyFingerprintRawID(fingerprint []byte) (uint32, error) {
	if len(fingerprint) == 0 {
		return 0, errors.New("app-state sync key fingerprint is empty")
	}
	var decoded waE2E.AppStateSyncKeyFingerprint
	if err := proto.Unmarshal(fingerprint, &decoded); err != nil || decoded.RawID == nil {
		return 0, errors.New("app-state sync key fingerprint is invalid")
	}
	return decoded.GetRawID(), nil
}

func checksumWhatsmeowAppStateSyncKeyRow(
	keyID []byte,
	keyData []byte,
	timestamp int64,
	fingerprint []byte,
) string {
	hasher := sha256.New()
	for _, value := range [][]byte{keyID, keyData, fingerprint} {
		var size [8]byte
		binary.BigEndian.PutUint64(size[:], uint64(len(value)))
		_, _ = hasher.Write(size[:])
		_, _ = hasher.Write(value)
	}
	var encodedTimestamp [8]byte
	binary.BigEndian.PutUint64(encodedTimestamp[:], uint64(timestamp))
	_, _ = hasher.Write(encodedTimestamp[:])
	return hex.EncodeToString(hasher.Sum(nil))
}

func summarizeWhatsmeowAppStateSyncKeyProof(
	entries []whatsmeowAppStateSyncKeyProofEntry,
) (map[uint32]whatsmeowAppStateSyncKeyChainAnchor, uint32, int, int64, error) {
	if len(entries) == 0 {
		return nil, 0, 0, 0, errors.New(
			"whatsmeow_app_state_snapshot_resync_sync_key_proof_invalid",
		)
	}
	chains := make(map[uint32][]whatsmeowAppStateSyncKeyProofEntry)
	minRawID := entries[0].FingerprintRawID
	maxEpoch := -1
	maxTimestamp := int64(-1)
	for _, entry := range entries {
		chains[entry.FingerprintRawID] = append(chains[entry.FingerprintRawID], entry)
		if entry.FingerprintRawID < minRawID {
			minRawID = entry.FingerprintRawID
		}
		if entry.Epoch > maxEpoch {
			maxEpoch = entry.Epoch
		}
		if entry.Timestamp > maxTimestamp {
			maxTimestamp = entry.Timestamp
		}
	}
	anchors := make(map[uint32]whatsmeowAppStateSyncKeyChainAnchor, len(chains))
	for rawID, chain := range chains {
		sort.Slice(chain, func(left, right int) bool {
			return chain[left].Epoch < chain[right].Epoch
		})
		lastKnownTimestamp := int64(0)
		for index := 1; index < len(chain); index++ {
			if chain[index].Epoch == chain[index-1].Epoch {
				return nil, 0, 0, 0, errors.New(
					"whatsmeow_app_state_snapshot_resync_sync_key_proof_invalid",
				)
			}
		}
		for _, entry := range chain {
			// WhatsApp persists zero for legacy keys whose creation timestamp is
			// unknown. It is not an ordering value and must not make an otherwise
			// monotonic epoch chain look as though time moved backwards.
			if entry.Timestamp == 0 {
				continue
			}
			if lastKnownTimestamp != 0 && entry.Timestamp < lastKnownTimestamp {
				return nil, 0, 0, 0, errors.New(
					"whatsmeow_app_state_snapshot_resync_sync_key_proof_invalid",
				)
			}
			lastKnownTimestamp = entry.Timestamp
		}
		last := chain[len(chain)-1]
		anchors[rawID] = whatsmeowAppStateSyncKeyChainAnchor{
			Epoch: last.Epoch, Timestamp: lastKnownTimestamp,
		}
	}
	return anchors, minRawID, maxEpoch, maxTimestamp, nil
}

func captureWhatsmeowAppStateSyncKeyAnchorProof(
	ctx context.Context,
	queryer interface {
		QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	},
	sessionID string,
	revisionID int64,
) (whatsmeowAppStateSyncKeyAnchorProof, error) {
	rows, err := queryer.QueryContext(ctx, `
		SELECT key_id, key_data, timestamp, fingerprint
		FROM whatsapp_app_state_sync_keys
		WHERE session_id=$1::uuid AND revision_id=$2
		ORDER BY key_id
	`, sessionID, revisionID)
	if err != nil {
		return whatsmeowAppStateSyncKeyAnchorProof{}, err
	}
	defer rows.Close()

	proof := whatsmeowAppStateSyncKeyAnchorProof{MaxTimestamp: -1}
	seen := make(map[string]struct{})
	for rows.Next() {
		var keyID, keyData, fingerprint []byte
		var timestamp int64
		if err := rows.Scan(&keyID, &keyData, &timestamp, &fingerprint); err != nil {
			return whatsmeowAppStateSyncKeyAnchorProof{}, err
		}
		if len(keyData) != 32 || timestamp < 0 {
			return whatsmeowAppStateSyncKeyAnchorProof{}, errors.New(
				"whatsmeow_app_state_snapshot_resync_sync_key_invalid",
			)
		}
		epoch, err := whatsmeowAppStateSyncKeyEpoch(keyID)
		if err != nil {
			return whatsmeowAppStateSyncKeyAnchorProof{}, errors.New(
				"whatsmeow_app_state_snapshot_resync_sync_key_invalid",
			)
		}
		rawID, err := whatsmeowAppStateSyncKeyFingerprintRawID(fingerprint)
		if err != nil {
			return whatsmeowAppStateSyncKeyAnchorProof{}, errors.New(
				"whatsmeow_app_state_snapshot_resync_sync_key_invalid",
			)
		}
		keyIDDigest := sha256.Sum256(keyID)
		keyIDChecksum := hex.EncodeToString(keyIDDigest[:])
		if _, duplicate := seen[keyIDChecksum]; duplicate {
			return whatsmeowAppStateSyncKeyAnchorProof{}, errors.New(
				"whatsmeow_app_state_snapshot_resync_sync_key_duplicate",
			)
		}
		seen[keyIDChecksum] = struct{}{}
		proof.Keys = append(proof.Keys, whatsmeowAppStateSyncKeyProofEntry{
			KeyIDChecksumSHA256: keyIDChecksum,
			RowChecksumSHA256: checksumWhatsmeowAppStateSyncKeyRow(
				keyID, keyData, timestamp, fingerprint,
			),
			Epoch: epoch, Timestamp: timestamp, FingerprintRawID: rawID,
		})
	}
	if err := rows.Err(); err != nil {
		return whatsmeowAppStateSyncKeyAnchorProof{}, err
	}
	if len(proof.Keys) == 0 {
		return whatsmeowAppStateSyncKeyAnchorProof{}, errors.New(
			"whatsmeow_app_state_snapshot_resync_sync_key_missing",
		)
	}
	sort.Slice(proof.Keys, func(left, right int) bool {
		return proof.Keys[left].KeyIDChecksumSHA256 < proof.Keys[right].KeyIDChecksumSHA256
	})
	_, minRawID, maxEpoch, maxTimestamp, err := summarizeWhatsmeowAppStateSyncKeyProof(proof.Keys)
	if err != nil {
		return whatsmeowAppStateSyncKeyAnchorProof{}, err
	}
	proof.Count = len(proof.Keys)
	proof.FingerprintRawID = minRawID
	proof.MaxEpoch = maxEpoch
	proof.MaxTimestamp = maxTimestamp
	return proof, nil
}

func validateWhatsmeowAppStateSyncKeyAnchorProof(
	source whatsmeowAppStateSyncKeyAnchorProof,
	target whatsmeowAppStateSyncKeyAnchorProof,
) error {
	sourceByID, sourceChains, err := validateWhatsmeowAppStateSyncKeyProofShape(source)
	if err != nil {
		return err
	}
	if _, _, err := validateWhatsmeowAppStateSyncKeyProofShape(target); err != nil {
		return err
	}
	if target.Count < source.Count {
		return errors.New("whatsmeow_app_state_snapshot_resync_sync_key_missing")
	}
	matched := 0
	for _, targetEntry := range target.Keys {
		sourceEntry, existed := sourceByID[targetEntry.KeyIDChecksumSHA256]
		if existed {
			if targetEntry != sourceEntry {
				return errors.New("whatsmeow_app_state_snapshot_resync_sync_key_changed")
			}
			matched++
			continue
		}
		anchor, anchored := sourceChains[targetEntry.FingerprintRawID]
		timestampRegressed := anchor.Timestamp != 0 &&
			targetEntry.Timestamp != 0 &&
			targetEntry.Timestamp < anchor.Timestamp
		if !anchored || targetEntry.Epoch <= anchor.Epoch || timestampRegressed {
			return errors.New("whatsmeow_app_state_snapshot_resync_extra_sync_key_invalid")
		}
	}
	if matched != source.Count {
		return errors.New("whatsmeow_app_state_snapshot_resync_sync_key_missing")
	}
	return nil
}

func validateWhatsmeowAppStateSyncKeyProofShape(
	proof whatsmeowAppStateSyncKeyAnchorProof,
) (map[string]whatsmeowAppStateSyncKeyProofEntry, map[uint32]whatsmeowAppStateSyncKeyChainAnchor, error) {
	if proof.Count <= 0 || proof.Count != len(proof.Keys) ||
		proof.MaxTimestamp < 0 || proof.MaxEpoch < 0 {
		return nil, nil, errors.New(
			"whatsmeow_app_state_snapshot_resync_sync_key_proof_invalid",
		)
	}
	entries := make(
		map[string]whatsmeowAppStateSyncKeyProofEntry, proof.Count,
	)
	lastKeyIDChecksum := ""
	for index, entry := range proof.Keys {
		keyIDChecksum, keyIDErr := hex.DecodeString(entry.KeyIDChecksumSHA256)
		rowChecksum, rowErr := hex.DecodeString(entry.RowChecksumSHA256)
		if keyIDErr != nil || rowErr != nil ||
			len(keyIDChecksum) != sha256.Size || len(rowChecksum) != sha256.Size ||
			entry.Timestamp < 0 || entry.Epoch < 0 ||
			(index > 0 && entry.KeyIDChecksumSHA256 <= lastKeyIDChecksum) {
			return nil, nil, errors.New(
				"whatsmeow_app_state_snapshot_resync_sync_key_proof_invalid",
			)
		}
		if _, duplicate := entries[entry.KeyIDChecksumSHA256]; duplicate {
			return nil, nil, errors.New(
				"whatsmeow_app_state_snapshot_resync_sync_key_proof_invalid",
			)
		}
		entries[entry.KeyIDChecksumSHA256] = entry
		lastKeyIDChecksum = entry.KeyIDChecksumSHA256
	}
	chains, minRawID, maxEpoch, maxTimestamp, err := summarizeWhatsmeowAppStateSyncKeyProof(proof.Keys)
	if err != nil {
		return nil, nil, err
	}
	if proof.MaxEpoch != maxEpoch || proof.MaxTimestamp != maxTimestamp ||
		proof.FingerprintRawID != minRawID {
		return nil, nil, errors.New(
			"whatsmeow_app_state_snapshot_resync_sync_key_proof_invalid",
		)
	}
	return entries, chains, nil
}

func validateWhatsmeowAppStateSnapshotResyncSource(
	ctx context.Context,
	queryer interface {
		QueryRowContext(context.Context, string, ...any) *sql.Row
	},
	sessionID string,
	revisionID int64,
	requirement whatsmeowAppStateSnapshotResyncRequirement,
) error {
	if !requirement.Required {
		return nil
	}
	var forbiddenVersionCount, forbiddenMACCount int64
	if err := queryer.QueryRowContext(ctx, `
		SELECT
		  (SELECT COUNT(*) FROM whatsapp_app_state_version
		   WHERE session_id=$1::uuid AND revision_id=$2
		     AND name=ANY($3::text[])),
		  (SELECT COUNT(*) FROM whatsapp_app_state_mutation_macs
		   WHERE session_id=$1::uuid AND revision_id=$2
		     AND name=ANY($3::text[]))
	`, sessionID, revisionID, pq.Array(requirement.Collections)).Scan(
		&forbiddenVersionCount, &forbiddenMACCount,
	); err != nil {
		return err
	}
	if forbiddenVersionCount != 0 || forbiddenMACCount != 0 {
		return errors.New("whatsmeow_wwebjs_app_state_snapshot_resync_source_inconsistent")
	}
	return nil
}

func newWhatsmeowAppStateSnapshotResyncManifest(
	source whatsmeowHandoffSourceScope,
	requirement whatsmeowAppStateSnapshotResyncRequirement,
	sourceKeys whatsmeowAppStateSyncKeyAnchorProof,
) whatsmeowAppStateSnapshotResyncManifest {
	return whatsmeowAppStateSnapshotResyncManifest{
		Version:                           whatsmeowAppStateSnapshotResyncGateVersion,
		HandoffID:                         source.HandoffID,
		LifecycleOperationID:              source.LifecycleOperationID,
		SourceProvider:                    source.SourceProvider,
		SourceRevisionID:                  source.SourceRevision,
		TargetProvider:                    source.TargetProvider,
		TargetRevisionID:                  source.TargetRevision,
		AppStateSnapshotResyncRequired:    requirement.Required,
		AppStateSnapshotResyncCollections: append([]string(nil), requirement.Collections...),
		SourceSyncKeys:                    sourceKeys,
		MaterializedCollections:           []whatsmeowAppStateMaterializedCollection{},
	}
}

func checksumWhatsmeowAppStateSnapshotResyncManifest(
	manifest whatsmeowAppStateSnapshotResyncManifest,
) ([]byte, string, error) {
	payload, err := json.Marshal(manifest)
	if err != nil {
		return nil, "", err
	}
	digest := sha256.Sum256(payload)
	return payload, hex.EncodeToString(digest[:]), nil
}

func validateWhatsmeowAppStateSnapshotResyncManifest(
	manifest whatsmeowAppStateSnapshotResyncManifest,
	source whatsmeowHandoffSourceScope,
	requirement whatsmeowAppStateSnapshotResyncRequirement,
) error {
	if manifest.Version != whatsmeowAppStateSnapshotResyncGateVersion ||
		manifest.HandoffID != source.HandoffID ||
		manifest.LifecycleOperationID != source.LifecycleOperationID ||
		manifest.SourceProvider != "wwebjs" ||
		manifest.SourceProvider != source.SourceProvider ||
		manifest.SourceRevisionID != source.SourceRevision ||
		manifest.TargetProvider != "whatsmeow" ||
		manifest.TargetProvider != source.TargetProvider ||
		manifest.TargetRevisionID != source.TargetRevision ||
		manifest.AppStateSnapshotResyncRequired != requirement.Required {
		return errors.New("whatsmeow_app_state_snapshot_resync_gate_lineage_invalid")
	}
	canonical, err := canonicalWhatsmeowAppStateSnapshotResyncCollections(
		manifest.AppStateSnapshotResyncCollections,
	)
	if err != nil || !equalStringSlices(canonical, manifest.AppStateSnapshotResyncCollections) ||
		!equalStringSlices(canonical, requirement.Collections) {
		return errors.New("whatsmeow_app_state_snapshot_resync_gate_collections_invalid")
	}
	if (manifest.AppStateSnapshotResyncRequired && len(canonical) == 0) ||
		(!manifest.AppStateSnapshotResyncRequired && len(canonical) != 0) {
		return errors.New("whatsmeow_app_state_snapshot_resync_gate_collections_invalid")
	}
	if err := validateWhatsmeowAppStateSyncKeyAnchorProof(
		manifest.SourceSyncKeys, manifest.SourceSyncKeys,
	); err != nil {
		return err
	}
	required := make(map[string]struct{}, len(canonical))
	for _, name := range canonical {
		required[name] = struct{}{}
	}
	lastName := ""
	for index, item := range manifest.MaterializedCollections {
		if item.Version < 0 {
			return errors.New("whatsmeow_app_state_snapshot_resync_checkpoint_invalid")
		}
		if _, ok := required[item.Name]; !ok || (index > 0 && item.Name <= lastName) {
			return errors.New("whatsmeow_app_state_snapshot_resync_checkpoint_invalid")
		}
		lastName = item.Name
	}
	if !requirement.Required && len(manifest.MaterializedCollections) != 0 {
		return errors.New("whatsmeow_app_state_snapshot_resync_checkpoint_invalid")
	}
	return nil
}

func equalStringSlices(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func equalWhatsmeowAppStateSyncKeyProof(
	left, right whatsmeowAppStateSyncKeyAnchorProof,
) bool {
	leftPayload, leftErr := json.Marshal(left)
	rightPayload, rightErr := json.Marshal(right)
	return leftErr == nil && rightErr == nil && equalBytes(leftPayload, rightPayload)
}

func readWhatsmeowAppStateSnapshotResyncState(
	ctx context.Context,
	tx *sql.Tx,
	sessionID string,
	revisionID int64,
	requirement whatsmeowAppStateSnapshotResyncRequirement,
	sourceKeys whatsmeowAppStateSyncKeyAnchorProof,
) (whatsmeowAppStateSnapshotResyncState, error) {
	targetKeys, err := captureWhatsmeowAppStateSyncKeyAnchorProof(
		ctx, tx, sessionID, revisionID,
	)
	if err != nil {
		return whatsmeowAppStateSnapshotResyncState{}, err
	}
	if err := validateWhatsmeowAppStateSyncKeyAnchorProof(sourceKeys, targetKeys); err != nil {
		return whatsmeowAppStateSnapshotResyncState{}, err
	}

	state := whatsmeowAppStateSnapshotResyncState{
		Versions:   make(map[string]int64, len(requirement.Collections)),
		TargetKeys: targetKeys,
	}
	if len(requirement.Collections) > 0 {
		rows, err := tx.QueryContext(ctx, `
			SELECT name, version
			FROM whatsapp_app_state_version
			WHERE session_id=$1::uuid AND revision_id=$2
			  AND name=ANY($3::text[])
		`, sessionID, revisionID, pq.Array(requirement.Collections))
		if err != nil {
			return whatsmeowAppStateSnapshotResyncState{}, err
		}
		defer rows.Close()
		for rows.Next() {
			var name string
			var version int64
			if err := rows.Scan(&name, &version); err != nil {
				return whatsmeowAppStateSnapshotResyncState{}, err
			}
			if version < 0 {
				return whatsmeowAppStateSnapshotResyncState{}, errors.New(
					"whatsmeow_app_state_snapshot_resync_version_invalid",
				)
			}
			state.Versions[name] = version
		}
		if err := rows.Err(); err != nil {
			return whatsmeowAppStateSnapshotResyncState{}, err
		}
	}
	if err := tx.QueryRowContext(ctx, `
		SELECT EXISTS (
		  SELECT 1
		  FROM whatsapp_app_state_mutation_macs AS mac
		  LEFT JOIN whatsapp_app_state_version AS version
		    ON version.session_id=mac.session_id
		   AND version.revision_id=mac.revision_id
		   AND version.name=mac.name
		  WHERE mac.session_id=$1::uuid AND mac.revision_id=$2
		    AND (version.name IS NULL OR mac.version > version.version)
		)
	`, sessionID, revisionID).Scan(&state.FutureMAC); err != nil {
		return whatsmeowAppStateSnapshotResyncState{}, err
	}
	if state.FutureMAC {
		return whatsmeowAppStateSnapshotResyncState{}, errors.New(
			"whatsmeow_app_state_snapshot_resync_future_mutation_mac",
		)
	}
	return state, nil
}

func materializeWhatsmeowAppStateSnapshotResyncManifest(
	manifest *whatsmeowAppStateSnapshotResyncManifest,
	state whatsmeowAppStateSnapshotResyncState,
	eventName string,
	eventVersion int64,
) (bool, error) {
	if state.FutureMAC {
		return false, errors.New(
			"whatsmeow_app_state_snapshot_resync_future_mutation_mac",
		)
	}
	requirement := whatsmeowAppStateSnapshotResyncRequirement{
		Required:    manifest.AppStateSnapshotResyncRequired,
		Collections: manifest.AppStateSnapshotResyncCollections,
	}
	if !requirement.Required {
		manifest.MaterializedCollections = []whatsmeowAppStateMaterializedCollection{}
		return true, nil
	}
	required := make(map[string]struct{}, len(requirement.Collections))
	for _, name := range requirement.Collections {
		required[name] = struct{}{}
	}
	completed := make(map[string]int64, len(manifest.MaterializedCollections))
	for _, item := range manifest.MaterializedCollections {
		completed[item.Name] = item.Version
	}
	if eventName != "" {
		if _, ok := required[eventName]; !ok {
			return false, errors.New("whatsmeow_app_state_snapshot_resync_event_out_of_scope")
		}
		persistedVersion, ok := state.Versions[eventName]
		if !ok || eventVersion < 0 || persistedVersion != eventVersion {
			return false, errors.New("whatsmeow_app_state_snapshot_resync_event_not_durable")
		}
		completed[eventName] = eventVersion
	}

	allVersionsMaterialized := len(state.Versions) == len(requirement.Collections)
	if allVersionsMaterialized {
		// A version row for a collection removed by the source marker can only be
		// created by WhatsMeow's authenticated full-sync. Reconstructing this list
		// makes a crash between SQLStore commit and event checkpoint idempotent.
		for _, name := range requirement.Collections {
			version, ok := state.Versions[name]
			if !ok {
				allVersionsMaterialized = false
				break
			}
			completed[name] = version
		}
	}
	manifest.MaterializedCollections = manifest.MaterializedCollections[:0]
	for name, version := range completed {
		manifest.MaterializedCollections = append(
			manifest.MaterializedCollections,
			whatsmeowAppStateMaterializedCollection{Name: name, Version: version},
		)
	}
	sort.Slice(manifest.MaterializedCollections, func(left, right int) bool {
		return manifest.MaterializedCollections[left].Name <
			manifest.MaterializedCollections[right].Name
	})
	return allVersionsMaterialized &&
		len(manifest.MaterializedCollections) == len(requirement.Collections), nil
}

func persistWhatsmeowAppStateSnapshotResyncArtifact(
	ctx context.Context,
	tx *sql.Tx,
	sessionID string,
	artifactID string,
	manifest whatsmeowAppStateSnapshotResyncManifest,
	ready bool,
) error {
	payload, checksum, err := checksumWhatsmeowAppStateSnapshotResyncManifest(manifest)
	if err != nil {
		return err
	}
	status := "staging"
	if ready {
		status = "ready"
	}
	result, err := tx.ExecContext(ctx, `
		INSERT INTO whatsapp_artifact (
		  session_id, artifact_id, revision_id, provider, kind, status,
		  manifest, checksum_sha256, size_bytes, chunk_count, persisted_at
		) VALUES (
		  $1::uuid, $2::uuid, $3, 'whatsmeow', $4, $5,
		  $6::jsonb, $7, $8, 0, clock_timestamp()
		)
		ON CONFLICT (session_id, artifact_id) DO UPDATE SET
		  status=EXCLUDED.status,
		  manifest=EXCLUDED.manifest,
		  checksum_sha256=EXCLUDED.checksum_sha256,
		  size_bytes=EXCLUDED.size_bytes,
		  chunk_count=0,
		  persisted_at=clock_timestamp()
		WHERE whatsapp_artifact.revision_id=EXCLUDED.revision_id
		  AND whatsapp_artifact.provider='whatsmeow'
		  AND whatsapp_artifact.kind=$4
		  AND whatsapp_artifact.status IN ('staging', 'ready')
		  AND (
		    whatsapp_artifact.status='staging'
		    OR EXCLUDED.status='ready'
		  )
	`, sessionID, artifactID, manifest.TargetRevisionID,
		whatsmeowAppStateSnapshotResyncArtifactKind, status,
		string(payload), checksum, len(payload))
	if err != nil {
		return err
	}
	if affected, _ := result.RowsAffected(); affected != 1 {
		return errors.New("whatsmeow_app_state_snapshot_resync_artifact_scope_changed")
	}
	return nil
}

func readWhatsmeowAppStateSnapshotResyncArtifact(
	ctx context.Context,
	tx *sql.Tx,
	sessionID string,
	artifactID string,
	forUpdate bool,
) (whatsmeowAppStateSnapshotResyncManifest, string, error) {
	locking := ""
	if forUpdate {
		locking = " FOR UPDATE"
	}
	var storedArtifactID, provider, kind, status, checksum string
	var revisionID int64
	var payload []byte
	var sizeBytes, chunkCount int
	var persistedAt sql.NullTime
	err := tx.QueryRowContext(ctx, `
		SELECT artifact_id::text, revision_id, provider, kind, status,
		       manifest, checksum_sha256, size_bytes, chunk_count, persisted_at
		FROM whatsapp_artifact
		WHERE session_id=$1::uuid AND artifact_id=$2::uuid
		  AND provider='whatsmeow' AND kind=$3
	`+locking, sessionID, artifactID,
		whatsmeowAppStateSnapshotResyncArtifactKind).Scan(
		&storedArtifactID, &revisionID, &provider, &kind, &status,
		&payload, &checksum, &sizeBytes, &chunkCount, &persistedAt,
	)
	if err != nil {
		return whatsmeowAppStateSnapshotResyncManifest{}, "", err
	}
	var manifest whatsmeowAppStateSnapshotResyncManifest
	if err := json.Unmarshal(payload, &manifest); err != nil {
		return whatsmeowAppStateSnapshotResyncManifest{}, "", errors.New(
			"whatsmeow_app_state_snapshot_resync_artifact_invalid",
		)
	}
	canonicalPayload, canonicalChecksum, err := checksumWhatsmeowAppStateSnapshotResyncManifest(manifest)
	if err != nil || storedArtifactID != artifactID ||
		revisionID != manifest.TargetRevisionID || provider != "whatsmeow" ||
		kind != whatsmeowAppStateSnapshotResyncArtifactKind || chunkCount != 0 ||
		!persistedAt.Valid || sizeBytes != len(canonicalPayload) ||
		checksum != canonicalChecksum {
		return whatsmeowAppStateSnapshotResyncManifest{}, "", errors.New(
			"whatsmeow_app_state_snapshot_resync_artifact_checksum_invalid",
		)
	}
	if status != "staging" && status != "ready" {
		return whatsmeowAppStateSnapshotResyncManifest{}, "", errors.New(
			"whatsmeow_app_state_snapshot_resync_artifact_status_invalid",
		)
	}
	return manifest, status, nil
}

func ensureWhatsmeowAppStateSnapshotResyncGate(
	ctx context.Context,
	tx *sql.Tx,
	sessionID string,
	source whatsmeowHandoffSourceScope,
	requirement whatsmeowAppStateSnapshotResyncRequirement,
	sourceKeys whatsmeowAppStateSyncKeyAnchorProof,
) (whatsmeowAppStateSnapshotResyncGate, error) {
	artifactID, err := whatsmeowAppStateSnapshotResyncArtifactID(source.HandoffID)
	if err != nil {
		return whatsmeowAppStateSnapshotResyncGate{}, err
	}
	manifest := newWhatsmeowAppStateSnapshotResyncManifest(source, requirement, sourceKeys)
	stored, status, readErr := readWhatsmeowAppStateSnapshotResyncArtifact(
		ctx, tx, sessionID, artifactID, true,
	)
	if readErr == nil {
		if err := validateWhatsmeowAppStateSnapshotResyncManifest(
			stored, source, requirement,
		); err != nil {
			return whatsmeowAppStateSnapshotResyncGate{}, err
		}
		if !equalWhatsmeowAppStateSyncKeyProof(stored.SourceSyncKeys, sourceKeys) {
			return whatsmeowAppStateSnapshotResyncGate{}, errors.New(
				"whatsmeow_app_state_snapshot_resync_source_sync_key_proof_changed",
			)
		}
		manifest = stored
	} else if !errors.Is(readErr, sql.ErrNoRows) {
		return whatsmeowAppStateSnapshotResyncGate{}, readErr
	}
	state, err := readWhatsmeowAppStateSnapshotResyncState(
		ctx, tx, sessionID, source.TargetRevision, requirement, sourceKeys,
	)
	if err != nil {
		return whatsmeowAppStateSnapshotResyncGate{}, err
	}
	ready, err := materializeWhatsmeowAppStateSnapshotResyncManifest(
		&manifest, state, "", 0,
	)
	if err != nil {
		return whatsmeowAppStateSnapshotResyncGate{}, err
	}
	if status == "ready" && !ready {
		return whatsmeowAppStateSnapshotResyncGate{}, errors.New(
			"whatsmeow_app_state_snapshot_resync_ready_artifact_diverged",
		)
	}
	if err := persistWhatsmeowAppStateSnapshotResyncArtifact(
		ctx, tx, sessionID, artifactID, manifest, ready,
	); err != nil {
		return whatsmeowAppStateSnapshotResyncGate{}, err
	}
	return whatsmeowAppStateSnapshotResyncGate{ArtifactID: artifactID, Ready: ready}, nil
}

func (p *WorkerPostgres) checkpointWhatsmeowAppStateSnapshotResync(
	ctx context.Context,
	cfg Config,
	stage *whatsmeowImportStage,
	eventName string,
	eventVersion int64,
) (bool, error) {
	if p == nil || p.DB == nil || stage == nil ||
		stage.CandidateRevision <= 0 || stage.HandoffID == "" ||
		stage.AppStateSnapshotResyncArtifactID == "" {
		return false, errors.New("whatsmeow_app_state_snapshot_resync_runtime_scope_invalid")
	}
	ready := false
	err := p.withWhatsmeowSessionMutation(
		ctx, cfg, stage.CandidateRevision,
		func(tx *sql.Tx, _ whatsmeowOperationFence) error {
			var source whatsmeowHandoffSourceScope
			if err := tx.QueryRowContext(ctx, `
				SELECT source_provider, source_revision_id, target_provider,
				       target_revision_id, handoff_id::text,
				       lifecycle_operation_id::text
				FROM whatsapp_session_handoff
				WHERE session_id=$1::uuid AND handoff_id=$2::uuid
				  AND target_revision_id=$3 AND target_provider='whatsmeow'
				  AND state IN ('hydrating', 'validating', 'promoting')
			`, cfg.WorkerID, stage.HandoffID, stage.CandidateRevision).Scan(
				&source.SourceProvider, &source.SourceRevision,
				&source.TargetProvider, &source.TargetRevision,
				&source.HandoffID, &source.LifecycleOperationID,
			); err != nil {
				return err
			}
			if source.SourceProvider != "wwebjs" ||
				source.SourceRevision != stage.PreviousRevision {
				return errors.New("whatsmeow_app_state_snapshot_resync_handoff_scope_changed")
			}
			artifactID, err := whatsmeowAppStateSnapshotResyncArtifactID(source.HandoffID)
			if err != nil || artifactID != stage.AppStateSnapshotResyncArtifactID {
				return errors.New("whatsmeow_app_state_snapshot_resync_artifact_scope_changed")
			}
			manifest, status, err := readWhatsmeowAppStateSnapshotResyncArtifact(
				ctx, tx, cfg.WorkerID, artifactID, true,
			)
			if err != nil {
				return err
			}
			requirement := whatsmeowAppStateSnapshotResyncRequirement{
				Required:    stage.AppStateSnapshotResyncRequired,
				Collections: append([]string(nil), stage.AppStateSnapshotResyncCollections...),
			}
			if err := validateWhatsmeowAppStateSnapshotResyncManifest(
				manifest, source, requirement,
			); err != nil {
				return err
			}
			state, err := readWhatsmeowAppStateSnapshotResyncState(
				ctx, tx, cfg.WorkerID, stage.CandidateRevision,
				requirement, manifest.SourceSyncKeys,
			)
			if err != nil {
				return err
			}
			ready, err = materializeWhatsmeowAppStateSnapshotResyncManifest(
				&manifest, state, eventName, eventVersion,
			)
			if err != nil {
				return err
			}
			if status == "ready" && !ready {
				return errors.New("whatsmeow_app_state_snapshot_resync_ready_artifact_diverged")
			}
			return persistWhatsmeowAppStateSnapshotResyncArtifact(
				ctx, tx, cfg.WorkerID, artifactID, manifest, ready,
			)
		},
	)
	return ready, err
}

func assertWhatsmeowAppStateSnapshotResyncGateReady(
	ctx context.Context,
	tx *sql.Tx,
	sessionID string,
	source whatsmeowHandoffSourceScope,
) error {
	artifactID, err := whatsmeowAppStateSnapshotResyncArtifactID(source.HandoffID)
	if err != nil {
		return err
	}
	manifest, status, err := readWhatsmeowAppStateSnapshotResyncArtifact(
		ctx, tx, sessionID, artifactID, true,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return errors.New("whatsmeow_app_state_snapshot_resync_gate_missing")
	}
	if err != nil {
		return err
	}
	requirement := whatsmeowAppStateSnapshotResyncRequirement{
		Required:    manifest.AppStateSnapshotResyncRequired,
		Collections: append([]string(nil), manifest.AppStateSnapshotResyncCollections...),
	}
	if err := validateWhatsmeowAppStateSnapshotResyncManifest(
		manifest, source, requirement,
	); err != nil {
		return err
	}
	state, err := readWhatsmeowAppStateSnapshotResyncState(
		ctx, tx, sessionID, source.TargetRevision, requirement,
		manifest.SourceSyncKeys,
	)
	if err != nil {
		return err
	}
	ready, err := materializeWhatsmeowAppStateSnapshotResyncManifest(
		&manifest, state, "", 0,
	)
	if err != nil {
		return err
	}
	if status != "ready" || !ready {
		return errors.New("whatsmeow_app_state_snapshot_resync_pending")
	}
	return nil
}

func whatsmeowAppStateSnapshotResyncTimeout(cfg Config) time.Duration {
	timeout := cfg.WhatsAppConnectTimeout * 2
	if timeout < whatsmeowAppStateSnapshotResyncMinTimeout {
		timeout = whatsmeowAppStateSnapshotResyncMinTimeout
	}
	if timeout > whatsmeowAppStateSnapshotResyncMaxTimeout {
		timeout = whatsmeowAppStateSnapshotResyncMaxTimeout
	}
	return timeout
}

func (m *WhatsAppManager) startProviderHandoffAppStateSnapshotResyncTimeout() {
	stage := m.providerHandoffStage.Load()
	if stage == nil || !stage.AppStateSnapshotResyncPending ||
		!m.providerHandoffSnapshotResyncPending.Load() {
		return
	}
	timeout := whatsmeowAppStateSnapshotResyncTimeout(m.cfg)
	logWhatsappSessionDebug(m.cfg.WhatsappSessionDebugEnabled, "handoff_app_state_snapshot_resync_waiting", map[string]any{
		"session_id":       m.cfg.WorkerID,
		"provider":         "whatsmeow",
		"revision":         stage.CandidateRevision,
		"stage":            "validating",
		"collection_count": len(stage.AppStateSnapshotResyncCollections),
		"collection_ids":   whatsmeowOpaqueAppStateCollectionIDs(stage.AppStateSnapshotResyncCollections),
		"timeout_ms":       timeout.Milliseconds(),
	})
	runtimeCtx := m.runtimeCtx
	if runtimeCtx == nil {
		runtimeCtx = context.Background()
	}
	go func(captured *whatsmeowImportStage) {
		timer := time.NewTimer(timeout)
		defer timer.Stop()
		select {
		case <-runtimeCtx.Done():
			return
		case <-timer.C:
		}
		m.providerHandoffAppStateResyncMu.Lock()
		defer m.providerHandoffAppStateResyncMu.Unlock()
		if m.providerHandoffStage.Load() != captured ||
			!m.providerHandoffSnapshotResyncPending.Load() {
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), workerDatabaseRecoveryTimeout)
		ready, err := m.postgres.checkpointWhatsmeowAppStateSnapshotResync(
			ctx, m.cfg, captured, "", 0,
		)
		cancel()
		if err == nil && ready {
			m.completeProviderHandoffAppStateSnapshotResync(captured, "timeout_reconcile")
			return
		}
		logWhatsappSessionDebug(m.cfg.WhatsappSessionDebugEnabled, "handoff_app_state_snapshot_resync_timeout", map[string]any{
			"session_id":       m.cfg.WorkerID,
			"provider":         "whatsmeow",
			"revision":         captured.CandidateRevision,
			"stage":            "rollback",
			"collection_count": len(captured.AppStateSnapshotResyncCollections),
			"collection_ids":   whatsmeowOpaqueAppStateCollectionIDs(captured.AppStateSnapshotResyncCollections),
			"error_code":       safeOperationalErrorCode(err),
		})
		if rollbackErr := m.rollbackActiveProviderHandoff(
			context.Background(), "app_state_snapshot_resync_timeout",
		); rollbackErr != nil {
			log.Printf("whatsmeow app-state snapshot resync timeout rollback failed worker_id=%s error_code=%s", m.cfg.WorkerID, safeOperationalErrorCode(rollbackErr))
		}
	}(stage)
}

func (m *WhatsAppManager) completeProviderHandoffAppStateSnapshotResync(
	stage *whatsmeowImportStage,
	reason string,
) {
	if stage == nil || m.providerHandoffStage.Load() != stage ||
		!m.providerHandoffSnapshotResyncPending.CompareAndSwap(true, false) {
		return
	}
	logWhatsappSessionDebug(m.cfg.WhatsappSessionDebugEnabled, "handoff_app_state_snapshot_resync_ready", map[string]any{
		"session_id":       m.cfg.WorkerID,
		"provider":         "whatsmeow",
		"revision":         stage.CandidateRevision,
		"stage":            "checkpoint_ready",
		"collection_count": len(stage.AppStateSnapshotResyncCollections),
		"collection_ids":   whatsmeowOpaqueAppStateCollectionIDs(stage.AppStateSnapshotResyncCollections),
		"reason":           reason,
	})
	if scope, ok := m.currentInboundConnectionScope(); ok {
		go m.publishConnectedWhenReadyForScope(
			context.Background(), scope,
			"app-state-snapshot-resync-ready", "", false,
		)
	}
}

func (m *WhatsAppManager) handleProviderHandoffAppStateSyncComplete(
	name string,
	version uint64,
) {
	stage := m.providerHandoffStage.Load()
	if stage == nil || !m.providerHandoffSnapshotResyncPending.Load() ||
		!stage.AppStateSnapshotResyncRequired ||
		!stringSliceContains(stage.AppStateSnapshotResyncCollections, name) {
		return
	}
	if version > uint64(1<<63-1) {
		m.scheduleProviderHandoffAppStateSnapshotResyncFailure(
			stage, name, errors.New("app-state version overflow"),
		)
		return
	}
	go func(captured *whatsmeowImportStage) {
		m.providerHandoffAppStateResyncMu.Lock()
		defer m.providerHandoffAppStateResyncMu.Unlock()
		if m.providerHandoffStage.Load() != captured ||
			!m.providerHandoffSnapshotResyncPending.Load() {
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), workerDatabaseRecoveryTimeout)
		ready, err := m.postgres.checkpointWhatsmeowAppStateSnapshotResync(
			ctx, m.cfg, captured, name, int64(version),
		)
		cancel()
		if err != nil {
			m.failProviderHandoffAppStateSnapshotResync(captured, name, err)
			return
		}
		logWhatsappSessionDebug(m.cfg.WhatsappSessionDebugEnabled, "handoff_app_state_snapshot_resync_checkpoint", map[string]any{
			"session_id":    m.cfg.WorkerID,
			"provider":      "whatsmeow",
			"revision":      captured.CandidateRevision,
			"stage":         "validating",
			"collection_id": whatsmeowOpaqueAppStateCollectionIDs([]string{name})[0],
			"version":       version,
			"ready":         ready,
		})
		if ready {
			m.completeProviderHandoffAppStateSnapshotResync(captured, "full_sync_complete")
		}
	}(stage)
}

func (m *WhatsAppManager) scheduleProviderHandoffAppStateSnapshotResyncFailure(
	stage *whatsmeowImportStage,
	name string,
	cause error,
) {
	go func() {
		m.providerHandoffAppStateResyncMu.Lock()
		defer m.providerHandoffAppStateResyncMu.Unlock()
		m.failProviderHandoffAppStateSnapshotResync(stage, name, cause)
	}()
}

func (m *WhatsAppManager) failProviderHandoffAppStateSnapshotResync(
	stage *whatsmeowImportStage,
	name string,
	cause error,
) {
	if stage == nil || m.providerHandoffStage.Load() != stage ||
		!m.providerHandoffSnapshotResyncPending.Load() {
		return
	}
	collectionIDs := []string{}
	if name != "" {
		collectionIDs = whatsmeowOpaqueAppStateCollectionIDs([]string{name})
	}
	logWhatsappSessionDebug(m.cfg.WhatsappSessionDebugEnabled, "handoff_app_state_snapshot_resync_failed", map[string]any{
		"session_id":     m.cfg.WorkerID,
		"provider":       "whatsmeow",
		"revision":       stage.CandidateRevision,
		"stage":          "rollback",
		"collection_ids": collectionIDs,
		"error_code":     safeOperationalErrorCode(cause),
	})
	if err := m.rollbackActiveProviderHandoff(
		context.Background(), "app_state_snapshot_resync_failed",
	); err != nil {
		log.Printf("whatsmeow app-state snapshot resync rollback failed worker_id=%s error_code=%s", m.cfg.WorkerID, safeOperationalErrorCode(err))
	}
}

func stringSliceContains(values []string, expected string) bool {
	index := sort.SearchStrings(values, expected)
	return index < len(values) && values[index] == expected
}
