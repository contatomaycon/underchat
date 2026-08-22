package app

import (
	"context"
	"encoding/json"
	"regexp"
	"sort"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"google.golang.org/protobuf/proto"
)

func TestPersistWhatsmeowAppStateSnapshotResyncArtifactBindsJSONAsText(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}

	manifest := whatsmeowAppStateSnapshotResyncManifest{
		Version:          whatsmeowAppStateSnapshotResyncGateVersion,
		TargetRevisionID: 42,
	}
	payload, _, err := checksumWhatsmeowAppStateSnapshotResyncManifest(manifest)
	if err != nil {
		t.Fatal(err)
	}
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO whatsapp_artifact")).
		WithArgs(
			"0198b905-35db-75de-a48f-99dd9133273c",
			"0198b905-35db-75de-a48f-99dd9133273d",
			int64(42),
			whatsmeowAppStateSnapshotResyncArtifactKind,
			"staging",
			string(payload),
			sqlmock.AnyArg(),
			len(payload),
		).
		WillReturnResult(sqlmock.NewResult(0, 1))

	if !json.Valid(payload) {
		t.Fatal("fixture manifest is not valid JSON")
	}
	if err := persistWhatsmeowAppStateSnapshotResyncArtifact(
		context.Background(), tx,
		"0198b905-35db-75de-a48f-99dd9133273c",
		"0198b905-35db-75de-a48f-99dd9133273d",
		manifest, false,
	); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestWhatsmeowAppStateSnapshotResyncCapabilitiesFailClosed(t *testing.T) {
	boolPointer := func(value bool) *bool { return &value }
	collectionsPointer := func(values ...string) *[]string {
		copyOfValues := append([]string(nil), values...)
		return &copyOfValues
	}

	for name, test := range map[string]struct {
		capabilities whatsmeowWWebPQCapabilities
		wantRequired bool
		wantNames    []string
		wantError    bool
	}{
		"explicit no resync": {
			capabilities: whatsmeowWWebPQCapabilities{
				AppStateSnapshotResyncRequired:    boolPointer(false),
				AppStateSnapshotResyncCollections: collectionsPointer(),
			},
		},
		"explicit canonical resync": {
			capabilities: whatsmeowWWebPQCapabilities{
				AppStateSnapshotResyncRequired: boolPointer(true),
				AppStateSnapshotResyncCollections: collectionsPointer(
					"critical_block", "regular", "regular_high",
				),
			},
			wantRequired: true,
			wantNames:    []string{"critical_block", "regular", "regular_high"},
		},
		"missing both fields": {wantError: true},
		"missing exact collection list": {
			capabilities: whatsmeowWWebPQCapabilities{
				AppStateSnapshotResyncRequired: boolPointer(true),
			},
			wantError: true,
		},
		"missing required marker": {
			capabilities: whatsmeowWWebPQCapabilities{
				AppStateSnapshotResyncCollections: collectionsPointer("regular"),
			},
			wantError: true,
		},
		"required without removed collections": {
			capabilities: whatsmeowWWebPQCapabilities{
				AppStateSnapshotResyncRequired:    boolPointer(true),
				AppStateSnapshotResyncCollections: collectionsPointer(),
			},
			wantError: true,
		},
		"not required with removed collections": {
			capabilities: whatsmeowWWebPQCapabilities{
				AppStateSnapshotResyncRequired:    boolPointer(false),
				AppStateSnapshotResyncCollections: collectionsPointer("regular"),
			},
			wantError: true,
		},
		"unknown collection": {
			capabilities: whatsmeowWWebPQCapabilities{
				AppStateSnapshotResyncRequired:    boolPointer(true),
				AppStateSnapshotResyncCollections: collectionsPointer("unknown"),
			},
			wantError: true,
		},
		"duplicate collection": {
			capabilities: whatsmeowWWebPQCapabilities{
				AppStateSnapshotResyncRequired: boolPointer(true),
				AppStateSnapshotResyncCollections: collectionsPointer(
					"regular", "regular",
				),
			},
			wantError: true,
		},
		"noncanonical ordering": {
			capabilities: whatsmeowWWebPQCapabilities{
				AppStateSnapshotResyncRequired: boolPointer(true),
				AppStateSnapshotResyncCollections: collectionsPointer(
					"regular_high", "regular",
				),
			},
			wantError: true,
		},
	} {
		t.Run(name, func(t *testing.T) {
			requirement, err := whatsmeowAppStateSnapshotResyncRequirementFromCapabilities(
				test.capabilities,
			)
			if test.wantError {
				if err == nil {
					t.Fatal("incomplete or inconsistent capability marker was accepted")
				}
				return
			}
			if err != nil {
				t.Fatalf("valid capability marker was rejected: %v", err)
			}
			if requirement.Required != test.wantRequired ||
				!equalStringSlices(requirement.Collections, test.wantNames) {
				t.Fatalf("unexpected requirement: %+v", requirement)
			}
		})
	}
}

func TestWhatsmeowAppStateSnapshotResyncArtifactIDUsesCommonABI(t *testing.T) {
	artifactID, err := whatsmeowAppStateSnapshotResyncArtifactID(
		"019fcf34-8075-726d-accc-cc45a9dc44fa",
	)
	if err != nil {
		t.Fatal(err)
	}
	if artifactID != "1560ff3f-8de0-5f4a-bf76-be4df92a2056" {
		t.Fatalf("provider-neutral artifact UUID changed: %s", artifactID)
	}
}

func TestWhatsmeowAppStateSnapshotResyncCommonABIVector(t *testing.T) {
	manifest := whatsmeowAppStateSnapshotResyncManifest{
		Version:                           1,
		HandoffID:                         "019fcf34-8075-726d-accc-cc45a9dc44fa",
		LifecycleOperationID:              "019fcf34-8075-726d-accc-cc45a9dc44fb",
		SourceProvider:                    "wwebjs",
		SourceRevisionID:                  41,
		TargetProvider:                    "baileys",
		TargetRevisionID:                  42,
		AppStateSnapshotResyncRequired:    true,
		AppStateSnapshotResyncCollections: []string{"critical_block", "regular"},
		SourceSyncKeys: whatsmeowAppStateSyncKeyAnchorProof{
			Count: 2, MaxEpoch: 258, MaxTimestamp: 1700000000001,
			FingerprintRawID: 7,
			Keys: []whatsmeowAppStateSyncKeyProofEntry{
				{
					KeyIDChecksumSHA256: strings.Repeat("1", 64),
					RowChecksumSHA256:   strings.Repeat("2", 64),
					Epoch:               257, Timestamp: 1700000000000, FingerprintRawID: 7,
				},
				{
					KeyIDChecksumSHA256: strings.Repeat("a", 64),
					RowChecksumSHA256:   strings.Repeat("b", 64),
					Epoch:               258, Timestamp: 1700000000001, FingerprintRawID: 7,
				},
			},
		},
		MaterializedCollections: []whatsmeowAppStateMaterializedCollection{
			{Name: "critical_block", Version: 5},
			{Name: "regular", Version: 9},
		},
	}
	payload, checksum, err := checksumWhatsmeowAppStateSnapshotResyncManifest(
		manifest,
	)
	if err != nil {
		t.Fatal(err)
	}
	expectedJSON := `{"version":1,"handoff_id":"019fcf34-8075-726d-accc-cc45a9dc44fa","lifecycle_operation_id":"019fcf34-8075-726d-accc-cc45a9dc44fb","source_provider":"wwebjs","source_revision_id":41,"target_provider":"baileys","target_revision_id":42,"app_state_snapshot_resync_required":true,"app_state_snapshot_resync_collections":["critical_block","regular"],"source_sync_keys":{"count":2,"max_epoch":258,"max_timestamp":1700000000001,"fingerprint_raw_id":7,"keys":[{"key_id_checksum_sha256":"1111111111111111111111111111111111111111111111111111111111111111","row_checksum_sha256":"2222222222222222222222222222222222222222222222222222222222222222","epoch":257,"timestamp":1700000000000,"fingerprint_raw_id":7},{"key_id_checksum_sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","row_checksum_sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","epoch":258,"timestamp":1700000000001,"fingerprint_raw_id":7}]},"materialized_collections":[{"name":"critical_block","version":5},{"name":"regular","version":9}]}`
	if string(payload) != expectedJSON {
		t.Fatalf("canonical ABI JSON changed:\n%s", payload)
	}
	if len(payload) != 1038 {
		t.Fatalf("canonical ABI payload size changed: %d", len(payload))
	}
	if checksum != "1b42d31b30a18a851bc5150275c34306ff6249d1fb8655bca6c79609c62c3b3a" {
		t.Fatalf("canonical ABI checksum changed: %s", checksum)
	}
}

func TestWhatsmeowAppStateSyncKeyFingerprintAndEpoch(t *testing.T) {
	rawID := uint32(73)
	currentIndex := uint32(9)
	fingerprint, err := proto.Marshal(&waE2E.AppStateSyncKeyFingerprint{
		RawID:         &rawID,
		CurrentIndex:  &currentIndex,
		DeviceIndexes: []uint32{1, 4, 9},
	})
	if err != nil {
		t.Fatal(err)
	}
	gotRawID, err := whatsmeowAppStateSyncKeyFingerprintRawID(fingerprint)
	if err != nil || gotRawID != rawID {
		t.Fatalf("fingerprint raw ID = %d, %v", gotRawID, err)
	}
	if _, err := whatsmeowAppStateSyncKeyFingerprintRawID(nil); err == nil {
		t.Fatal("empty fingerprint was accepted")
	}
	if epoch, err := whatsmeowAppStateSyncKeyEpoch(
		[]byte{0xaa, 0xbb, 0x01, 0x02},
	); err != nil || epoch != 258 {
		t.Fatalf("sync-key epoch = %d, %v", epoch, err)
	}
	if _, err := whatsmeowAppStateSyncKeyEpoch([]byte{0x01}); err == nil {
		t.Fatal("incomplete sync-key ID was accepted")
	}
}

func testWhatsmeowAppStateSyncKeyProof() whatsmeowAppStateSyncKeyAnchorProof {
	const rawID uint32 = 73
	return whatsmeowAppStateSyncKeyAnchorProof{
		Count:            1,
		MaxEpoch:         4,
		MaxTimestamp:     100,
		FingerprintRawID: rawID,
		Keys: []whatsmeowAppStateSyncKeyProofEntry{{
			KeyIDChecksumSHA256: strings.Repeat("1", 64),
			RowChecksumSHA256:   strings.Repeat("a", 64),
			Epoch:               4,
			Timestamp:           100,
			FingerprintRawID:    rawID,
		}},
	}
}

func testWhatsmeowAppStateSyncKeyProofWithExtra(
	epoch int,
	timestamp int64,
	rawID uint32,
) whatsmeowAppStateSyncKeyAnchorProof {
	proof := testWhatsmeowAppStateSyncKeyProof()
	proof.Keys = append(proof.Keys, whatsmeowAppStateSyncKeyProofEntry{
		KeyIDChecksumSHA256: strings.Repeat("2", 64),
		RowChecksumSHA256:   strings.Repeat("b", 64),
		Epoch:               epoch,
		Timestamp:           timestamp,
		FingerprintRawID:    rawID,
	})
	proof.Count = len(proof.Keys)
	if epoch > proof.MaxEpoch {
		proof.MaxEpoch = epoch
	}
	if timestamp > proof.MaxTimestamp {
		proof.MaxTimestamp = timestamp
	}
	return proof
}

func testWhatsmeowAppStateSyncKeyProofFromEntries(
	entries ...whatsmeowAppStateSyncKeyProofEntry,
) whatsmeowAppStateSyncKeyAnchorProof {
	proof := whatsmeowAppStateSyncKeyAnchorProof{
		Count:        len(entries),
		MaxEpoch:     -1,
		MaxTimestamp: -1,
		Keys:         append([]whatsmeowAppStateSyncKeyProofEntry(nil), entries...),
	}
	if len(entries) > 0 {
		proof.FingerprintRawID = entries[0].FingerprintRawID
	}
	for _, entry := range entries {
		if proof.MaxEpoch < entry.Epoch {
			proof.MaxEpoch = entry.Epoch
		}
		if proof.MaxTimestamp < entry.Timestamp {
			proof.MaxTimestamp = entry.Timestamp
		}
		if entry.FingerprintRawID < proof.FingerprintRawID {
			proof.FingerprintRawID = entry.FingerprintRawID
		}
	}
	sort.Slice(proof.Keys, func(left, right int) bool {
		return proof.Keys[left].KeyIDChecksumSHA256 < proof.Keys[right].KeyIDChecksumSHA256
	})
	return proof
}

func TestSummarizeWhatsmeowAppStateSyncKeyProofTreatsZeroTimestampAsUnknown(t *testing.T) {
	const rawID uint32 = 1126933948
	entry := func(digest string, epoch int, timestamp int64) whatsmeowAppStateSyncKeyProofEntry {
		return whatsmeowAppStateSyncKeyProofEntry{
			KeyIDChecksumSHA256: strings.Repeat(digest, 64),
			RowChecksumSHA256:   strings.Repeat(digest, 64),
			Epoch:               epoch,
			Timestamp:           timestamp,
			FingerprintRawID:    rawID,
		}
	}

	// Mirrors the live WWebJS source: known and unknown timestamps are
	// interleaved under one raw fingerprint ID while epochs keep advancing.
	liveLike := testWhatsmeowAppStateSyncKeyProofFromEntries(
		entry("1", 44329, 0),
		entry("2", 44331, 1786027545334),
		entry("3", 44332, 0),
		entry("4", 44334, 1786027761416),
		entry("5", 44335, 0),
		entry("6", 44337, 1786037068281),
		entry("7", 44338, 0),
		entry("8", 44340, 1786037281308),
		entry("9", 44341, 1786037282103),
	)
	if err := validateWhatsmeowAppStateSyncKeyAnchorProof(liveLike, liveLike); err != nil {
		t.Fatalf("live-like interleaved sync-key proof was rejected: %v", err)
	}

	for name, proof := range map[string]whatsmeowAppStateSyncKeyAnchorProof{
		"duplicate epoch with unknown timestamp": testWhatsmeowAppStateSyncKeyProofFromEntries(
			entry("1", 7, 100), entry("2", 7, 0),
		),
		"known timestamp regressed across unknown timestamp": testWhatsmeowAppStateSyncKeyProofFromEntries(
			entry("1", 7, 100), entry("2", 8, 0), entry("3", 9, 99),
		),
	} {
		t.Run(name, func(t *testing.T) {
			if err := validateWhatsmeowAppStateSyncKeyAnchorProof(proof, proof); err == nil {
				t.Fatal("invalid sync-key proof was accepted")
			}
		})
	}
}

func TestValidateWhatsmeowAppStateSyncKeyAnchorProof(t *testing.T) {
	source := testWhatsmeowAppStateSyncKeyProof()
	if err := validateWhatsmeowAppStateSyncKeyAnchorProof(source, source); err != nil {
		t.Fatalf("byte-identical sync-key projection was rejected: %v", err)
	}
	validExtra := testWhatsmeowAppStateSyncKeyProofWithExtra(
		5, source.MaxTimestamp, source.FingerprintRawID,
	)
	if err := validateWhatsmeowAppStateSyncKeyAnchorProof(source, validExtra); err != nil {
		t.Fatalf("valid monotonic extra sync key was rejected: %v", err)
	}
	unknownTimestampExtra := testWhatsmeowAppStateSyncKeyProofWithExtra(
		5, 0, source.FingerprintRawID,
	)
	if err := validateWhatsmeowAppStateSyncKeyAnchorProof(
		source, unknownTimestampExtra,
	); err != nil {
		t.Fatalf("extra sync key with unknown timestamp was rejected: %v", err)
	}
	unknownTimestampAnchor := testWhatsmeowAppStateSyncKeyProofFromEntries(
		whatsmeowAppStateSyncKeyProofEntry{
			KeyIDChecksumSHA256: strings.Repeat("1", 64),
			RowChecksumSHA256:   strings.Repeat("a", 64),
			Epoch:               4,
			Timestamp:           0,
			FingerprintRawID:    source.FingerprintRawID,
		},
	)
	knownTimestampAfterUnknown := testWhatsmeowAppStateSyncKeyProofFromEntries(
		unknownTimestampAnchor.Keys[0],
		whatsmeowAppStateSyncKeyProofEntry{
			KeyIDChecksumSHA256: strings.Repeat("2", 64),
			RowChecksumSHA256:   strings.Repeat("b", 64),
			Epoch:               5,
			Timestamp:           1,
			FingerprintRawID:    source.FingerprintRawID,
		},
	)
	if err := validateWhatsmeowAppStateSyncKeyAnchorProof(
		unknownTimestampAnchor, knownTimestampAfterUnknown,
	); err != nil {
		t.Fatalf("known timestamp after unknown anchor was rejected: %v", err)
	}
	twoExtrasWithDuplicateEpoch := testWhatsmeowAppStateSyncKeyProofFromEntries(
		source.Keys[0],
		whatsmeowAppStateSyncKeyProofEntry{
			KeyIDChecksumSHA256: strings.Repeat("2", 64),
			RowChecksumSHA256:   strings.Repeat("b", 64),
			Epoch:               5,
			Timestamp:           101,
			FingerprintRawID:    source.FingerprintRawID,
		},
		whatsmeowAppStateSyncKeyProofEntry{
			KeyIDChecksumSHA256: strings.Repeat("3", 64),
			RowChecksumSHA256:   strings.Repeat("c", 64),
			Epoch:               5,
			Timestamp:           0,
			FingerprintRawID:    source.FingerprintRawID,
		},
	)
	if err := validateWhatsmeowAppStateSyncKeyAnchorProof(
		source, twoExtrasWithDuplicateEpoch,
	); err == nil {
		t.Fatal("two target-only sync keys with a duplicate epoch were accepted")
	}

	multiChainSource := source
	multiChainSource.Keys = append(
		append([]whatsmeowAppStateSyncKeyProofEntry(nil), source.Keys...),
		whatsmeowAppStateSyncKeyProofEntry{
			KeyIDChecksumSHA256: strings.Repeat("2", 64),
			RowChecksumSHA256:   strings.Repeat("b", 64),
			Epoch:               2,
			Timestamp:           80,
			FingerprintRawID:    source.FingerprintRawID + 2,
		},
	)
	multiChainSource.Count = len(multiChainSource.Keys)
	multiChainTarget := multiChainSource
	multiChainTarget.Keys = append(
		append([]whatsmeowAppStateSyncKeyProofEntry(nil), multiChainSource.Keys...),
		whatsmeowAppStateSyncKeyProofEntry{
			KeyIDChecksumSHA256: strings.Repeat("3", 64),
			RowChecksumSHA256:   strings.Repeat("c", 64),
			Epoch:               3,
			Timestamp:           81,
			FingerprintRawID:    source.FingerprintRawID + 2,
		},
	)
	multiChainTarget.Count = len(multiChainTarget.Keys)
	if err := validateWhatsmeowAppStateSyncKeyAnchorProof(
		multiChainSource, multiChainTarget,
	); err != nil {
		t.Fatalf("independent anchored sync-key rotation was rejected: %v", err)
	}

	for name, mutate := range map[string]func() whatsmeowAppStateSyncKeyAnchorProof{
		"source key missing": func() whatsmeowAppStateSyncKeyAnchorProof {
			missing := source
			missing.Count = 0
			missing.Keys = nil
			return missing
		},
		"source key row changed": func() whatsmeowAppStateSyncKeyAnchorProof {
			changed := source
			changed.Keys = append([]whatsmeowAppStateSyncKeyProofEntry(nil), source.Keys...)
			changed.Keys[0].RowChecksumSHA256 = strings.Repeat("c", 64)
			return changed
		},
		"extra key epoch did not advance": func() whatsmeowAppStateSyncKeyAnchorProof {
			return testWhatsmeowAppStateSyncKeyProofWithExtra(
				source.MaxEpoch, source.MaxTimestamp+1, source.FingerprintRawID,
			)
		},
		"extra key timestamp regressed": func() whatsmeowAppStateSyncKeyAnchorProof {
			return testWhatsmeowAppStateSyncKeyProofWithExtra(
				source.MaxEpoch+1, source.MaxTimestamp-1, source.FingerprintRawID,
			)
		},
		"extra key raw ID diverged": func() whatsmeowAppStateSyncKeyAnchorProof {
			return testWhatsmeowAppStateSyncKeyProofWithExtra(
				source.MaxEpoch+1, source.MaxTimestamp, source.FingerprintRawID+1,
			)
		},
		"forged source maximum": func() whatsmeowAppStateSyncKeyAnchorProof {
			forged := source
			forged.MaxEpoch++
			return forged
		},
		"invalid digest encoding": func() whatsmeowAppStateSyncKeyAnchorProof {
			invalid := source
			invalid.Keys = append([]whatsmeowAppStateSyncKeyProofEntry(nil), source.Keys...)
			invalid.Keys[0].KeyIDChecksumSHA256 = strings.Repeat("z", 64)
			return invalid
		},
	} {
		t.Run(name, func(t *testing.T) {
			if err := validateWhatsmeowAppStateSyncKeyAnchorProof(
				source, mutate(),
			); err == nil {
				t.Fatal("invalid target sync-key proof was accepted")
			}
		})
	}
}

func TestMaterializeWhatsmeowAppStateSnapshotResyncManifest(t *testing.T) {
	newManifest := func() whatsmeowAppStateSnapshotResyncManifest {
		return whatsmeowAppStateSnapshotResyncManifest{
			AppStateSnapshotResyncRequired: true,
			AppStateSnapshotResyncCollections: []string{
				"regular", "regular_high",
			},
			MaterializedCollections: []whatsmeowAppStateMaterializedCollection{},
		}
	}

	manifest := newManifest()
	ready, err := materializeWhatsmeowAppStateSnapshotResyncManifest(
		&manifest,
		whatsmeowAppStateSnapshotResyncState{Versions: map[string]int64{}},
		"", 0,
	)
	if err != nil || ready || len(manifest.MaterializedCollections) != 0 {
		t.Fatalf("missing official snapshots became ready: ready=%t err=%v manifest=%+v", ready, err, manifest)
	}

	manifest = newManifest()
	if _, err := materializeWhatsmeowAppStateSnapshotResyncManifest(
		&manifest,
		whatsmeowAppStateSnapshotResyncState{
			Versions: map[string]int64{"regular": 7},
		},
		"regular", 6,
	); err == nil {
		t.Fatal("event version not durably materialized in PostgreSQL was accepted")
	}

	manifest = newManifest()
	if _, err := materializeWhatsmeowAppStateSnapshotResyncManifest(
		&manifest,
		whatsmeowAppStateSnapshotResyncState{
			Versions:  map[string]int64{"regular": 7, "regular_high": 9},
			FutureMAC: true,
		},
		"", 0,
	); err == nil {
		t.Fatal("mutation MAC above its durable collection watermark was accepted")
	}

	manifest = newManifest()
	ready, err = materializeWhatsmeowAppStateSnapshotResyncManifest(
		&manifest,
		whatsmeowAppStateSnapshotResyncState{
			Versions: map[string]int64{"regular": 7, "regular_high": 9},
		},
		"", 0,
	)
	if err != nil || !ready || len(manifest.MaterializedCollections) != 2 ||
		manifest.MaterializedCollections[0].Name != "regular" ||
		manifest.MaterializedCollections[0].Version != 7 ||
		manifest.MaterializedCollections[1].Name != "regular_high" ||
		manifest.MaterializedCollections[1].Version != 9 {
		t.Fatalf("durable official snapshots did not complete gate: ready=%t err=%v manifest=%+v", ready, err, manifest)
	}
}

func TestValidateWhatsmeowAppStateSnapshotResyncManifest(t *testing.T) {
	source := whatsmeowHandoffSourceScope{
		SourceProvider:       "wwebjs",
		SourceRevision:       41,
		TargetProvider:       "whatsmeow",
		TargetRevision:       42,
		HandoffID:            "0198b905-35db-75de-a48f-99dd9133273c",
		LifecycleOperationID: "0198b905-35db-75de-a48f-99dd9133273d",
	}
	requirement := whatsmeowAppStateSnapshotResyncRequirement{
		Required: true, Collections: []string{"regular", "regular_high"},
	}
	manifest := newWhatsmeowAppStateSnapshotResyncManifest(
		source, requirement, testWhatsmeowAppStateSyncKeyProof(),
	)
	if err := validateWhatsmeowAppStateSnapshotResyncManifest(
		manifest, source, requirement,
	); err != nil {
		t.Fatalf("valid gate manifest was rejected: %v", err)
	}

	for name, mutate := range map[string]func(*whatsmeowAppStateSnapshotResyncManifest){
		"lineage changed": func(candidate *whatsmeowAppStateSnapshotResyncManifest) {
			candidate.LifecycleOperationID = "0198b905-35db-75de-a48f-99dd9133273e"
		},
		"collection list changed": func(candidate *whatsmeowAppStateSnapshotResyncManifest) {
			candidate.AppStateSnapshotResyncCollections = []string{"regular"}
		},
		"collection order changed": func(candidate *whatsmeowAppStateSnapshotResyncManifest) {
			candidate.AppStateSnapshotResyncCollections = []string{"regular_high", "regular"}
		},
		"source sync key anchor changed": func(candidate *whatsmeowAppStateSnapshotResyncManifest) {
			candidate.SourceSyncKeys.MaxEpoch++
		},
		"checkpoint outside exact list": func(candidate *whatsmeowAppStateSnapshotResyncManifest) {
			candidate.MaterializedCollections = []whatsmeowAppStateMaterializedCollection{{
				Name: "critical_block", Version: 1,
			}}
		},
	} {
		t.Run(name, func(t *testing.T) {
			candidate := manifest
			candidate.AppStateSnapshotResyncCollections = append(
				[]string(nil), manifest.AppStateSnapshotResyncCollections...,
			)
			candidate.SourceSyncKeys.Keys = append(
				[]whatsmeowAppStateSyncKeyProofEntry(nil), manifest.SourceSyncKeys.Keys...,
			)
			mutate(&candidate)
			if err := validateWhatsmeowAppStateSnapshotResyncManifest(
				candidate, source, requirement,
			); err == nil {
				t.Fatal("divergent gate manifest was accepted")
			}
		})
	}
}

func TestWhatsmeowAppStateSnapshotResyncBlocksRuntimeReadiness(t *testing.T) {
	manager := &WhatsAppManager{}
	manager.providerHandoffSnapshotResyncPending.Store(true)
	if reason := manager.outboundReadinessReason(); reason != "app_state_snapshot_resync_pending" {
		t.Fatalf("outbound readiness reason = %q", reason)
	}
	health := manager.ConnectionHealth()
	if healthBool(health, "session_ready") ||
		healthBool(health, "can_receive_runtime") ||
		healthString(health, "degraded_reason") != "app_state_snapshot_resync_pending" {
		t.Fatalf("resync-pending health was not fail-closed: %+v", health)
	}
	if timeout := whatsmeowAppStateSnapshotResyncTimeout(Config{}); timeout != whatsmeowAppStateSnapshotResyncMinTimeout {
		t.Fatalf("minimum resync timeout = %s", timeout)
	}
}
