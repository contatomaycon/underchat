// Copyright (c) 2022 Tulir Asokan
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

package sqlstore

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/binary"
	"errors"
	"fmt"
	mathRand "math/rand/v2"
	"sync"
	"time"

	"github.com/google/uuid"
	"go.mau.fi/libsignal/ecc"
	"go.mau.fi/util/dbutil"
	"go.mau.fi/util/random"

	"go.mau.fi/whatsmeow/proto/waAdv"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/store/sqlstore/upgrades"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/util/keys"
	waLog "go.mau.fi/whatsmeow/util/log"
)

// Container is a wrapper for a SQL database that can contain multiple whatsmeow sessions.
type Container struct {
	db                     *dbutil.Database
	log                    waLog.Logger
	operationGuard         OperationGuard
	mutationGuard          OperationGuard
	operationFenceProvider OperationFenceProvider
	sessionDebugOutput     func(string)
	operationDebugMu       sync.Mutex
	operationDebug         map[SessionScope]*sessionOperationDebugSummary
	operationStateMu       sync.Mutex
	pausedOperations       map[SessionScope]bool
	inFlightOperations     map[SessionScope]int
}

type sessionOperationDebugSummary struct {
	windowStarted        time.Time
	operationCount       int64
	notFoundCount        int64
	errorCount           int64
	totalDurationMS      int64
	maxDurationMS        int64
	totalGuardDurationMS int64
	maxGuardDurationMS   int64
	fencingToken         int64
	generation           int64
}

// SessionScope is the immutable database ownership boundary of one provider
// projection. JID is deliberately absent because it is not a tenant key.
type SessionScope struct {
	SessionID  string
	RevisionID int64
}

// OperationFence is the lease generation that authorizes one transaction.
// Capability is the raw runtime secret and must never be persisted or logged.
type OperationFence struct {
	OwnerID      string
	FencingToken int64
	Generation   int64
	Epoch        string
	Capability   string
}

// OperationFenceProvider resolves the latest lease credentials immediately
// before each transaction. Implementations should use an atomic in-memory
// snapshot and must not perform network work while the DB transaction is open.
type OperationFenceProvider func(context.Context, SessionScope) (OperationFence, error)

// OperationGuard is called inside the same transaction as a scoped operation.
// Shared PostgreSQL deployments use distinct read and mutation guards so the
// database acquires its final row-lock mode before touching protocol tables.
type OperationGuard func(context.Context, *dbutil.Database, SessionScope, OperationFence) error

var (
	ErrOperationFenceUnavailable      = errors.New("whatsapp session operation fence unavailable")
	ErrOperationGuardRejected         = errors.New("whatsapp session operation guard rejected")
	ErrSessionOperationsPaused        = errors.New("whatsapp session operations are paused")
	ErrSessionMutationInReadTxn       = errors.New("whatsapp session mutation cannot run inside a read transaction")
	ErrLegacySQLiteVersionUnsupported = errors.New("legacy sqlite session schema version is unsupported")
	ErrLegacySQLiteSessionAmbiguous   = errors.New("legacy sqlite session adoption is ambiguous")
)

func validateOperationFence(fence OperationFence) error {
	if fence.OwnerID == "" {
		return errors.New("whatsapp operation owner ID is required")
	} else if fence.FencingToken <= 0 {
		return errors.New("whatsapp operation fencing token must be greater than zero")
	} else if fence.Generation <= 0 {
		return errors.New("whatsapp operation generation must be greater than zero")
	} else if _, err := uuid.Parse(fence.Epoch); err != nil {
		return errors.New("whatsapp operation epoch must be a UUID")
	} else if len(fence.Capability) < 32 || len(fence.Capability) > 512 {
		return errors.New("whatsapp operation capability must contain 32 to 512 characters")
	}
	return nil
}

// BeginPostgresSessionOperation installs a read-only transaction scope. The
// database keeps shared session/revision locks until the transaction ends.
func BeginPostgresSessionOperation(ctx context.Context, db *dbutil.Database, scope SessionScope, fence OperationFence) error {
	if err := validateOperationFence(fence); err != nil {
		return err
	}
	_, err := db.Exec(ctx, `
		SELECT begin_whatsapp_session_operation($1, $2, $3, $4, $5, $6::uuid, $7)
	`, scope.SessionID, scope.RevisionID, fence.OwnerID, fence.FencingToken, fence.Generation, fence.Epoch, fence.Capability)
	return err
}

// BeginPostgresSessionMutation installs a write transaction scope. The
// security-definer function validates the same fence as the read entry point,
// but acquires session/revision in their final exclusive mode up front. This
// avoids concurrent foreign-key KEY SHARE -> UPDATE lock upgrades.
func BeginPostgresSessionMutation(ctx context.Context, db *dbutil.Database, scope SessionScope, fence OperationFence) error {
	if err := validateOperationFence(fence); err != nil {
		return err
	}
	_, err := db.Exec(ctx, `
		SELECT begin_whatsapp_session_mutation($1, $2, $3, $4, $5, $6::uuid, $7)
	`, scope.SessionID, scope.RevisionID, fence.OwnerID, fence.FencingToken, fence.Generation, fence.Epoch, fence.Capability)
	return err
}

// SharedSchemaVersion is the exact schema revision provisioned by Underchat's
// Atlas migrations. Workers validate this revision and never run Upgrade on a
// shared PostgreSQL database.
const SharedSchemaVersion = 17

const DeviceFingerprintVersion = "underchat-whatsapp-device-fingerprint-v2"

var _ store.DeviceContainer = (*Container)(nil)

// New connects to the given SQL database and wraps it in a Container.
//
// Only SQLite and Postgres are currently fully supported.
//
// The logger can be nil and will default to a no-op logger.
//
// When using SQLite, it's strongly recommended to enable foreign keys by adding `?_foreign_keys=true`:
//
//	container, err := sqlstore.New(context.Background(), "sqlite3", "file:yoursqlitefile.db?_foreign_keys=on", nil)
func New(ctx context.Context, dialect, address string, log waLog.Logger) (*Container, error) {
	db, err := sql.Open(dialect, address)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}
	container := NewWithDB(db, dialect, log)
	err = container.Upgrade(ctx)
	if err != nil {
		_ = container.Close()
		return nil, fmt.Errorf("failed to upgrade database: %w", err)
	}
	return container, nil
}

// NewWithDB wraps an existing SQL connection in a Container.
//
// Only SQLite and Postgres are currently fully supported.
//
// The logger can be nil and will default to a no-op logger.
//
// When using SQLite, it's strongly recommended to enable foreign keys by adding `?_foreign_keys=true`:
//
//	db, err := sql.Open("sqlite3", "file:yoursqlitefile.db?_foreign_keys=on")
//	if err != nil {
//	    panic(err)
//	}
//	container := sqlstore.NewWithDB(db, "sqlite3", nil)
//
// This method does not call Upgrade automatically like New does, so you must call it yourself:
//
//	container := sqlstore.NewWithDB(...)
//	err := container.Upgrade()
func NewWithDB(db *sql.DB, dialect string, log waLog.Logger) *Container {
	wrapped, err := dbutil.NewWithDB(db, dialect)
	if err != nil {
		// This will only panic if the dialect is invalid
		panic(err)
	}
	wrapped.UpgradeTable = upgrades.Table
	wrapped.VersionTable = "whatsapp_store_version"
	return NewWithWrappedDB(wrapped, log)
}

func NewWithWrappedDB(wrapped *dbutil.Database, log waLog.Logger) *Container {
	if log == nil {
		log = waLog.Noop
	}
	return &Container{
		db:  wrapped,
		log: log,
	}
}

// SetOperationGuard configures the optional shared-database lease/RLS guard.
// Configure it before loading devices and don't replace it while operations
// are in flight.
func (c *Container) SetOperationGuard(guard OperationGuard) {
	c.operationGuard = guard
}

// SetMutationGuard configures the lease/RLS guard used by transactions that
// may execute DML. Shared PostgreSQL callers must configure both guards.
func (c *Container) SetMutationGuard(guard OperationGuard) {
	c.mutationGuard = guard
}

// SetOperationFenceProvider configures the dynamic lease credentials supplied
// to OperationGuard. Shared PostgreSQL stores must configure both callbacks.
func (c *Container) SetOperationFenceProvider(provider OperationFenceProvider) {
	c.operationFenceProvider = provider
}

// ConfigurePostgresSessionOperations enables the native lease/fencing guard.
// The provider is evaluated for every short transaction so takeover is seen
// without recreating the container.
func (c *Container) ConfigurePostgresSessionOperations(provider OperationFenceProvider) {
	c.SetOperationFenceProvider(provider)
	c.SetOperationGuard(BeginPostgresSessionOperation)
	c.SetMutationGuard(BeginPostgresSessionMutation)
}

// CurrentConnectionStatusFence returns the current in-memory lease generation
// without opening a database transaction. The configured provider contract
// already requires an atomic in-memory snapshot; the WhatsMeow client uses this
// method on status reads to fail closed after expiry, loss or takeover.
func (c *Container) CurrentConnectionStatusFence(sessionID string, revisionID int64) (store.ConnectionStatusFence, error) {
	if c == nil || c.operationFenceProvider == nil {
		return store.ConnectionStatusFence{Required: false}, nil
	}
	result := store.ConnectionStatusFence{Required: true}
	scope := SessionScope{SessionID: sessionID, RevisionID: revisionID}
	if sessionID == "" || revisionID <= 0 {
		return result, errors.New("whatsapp connection status fence scope is invalid")
	}
	fence, err := c.operationFenceProvider(context.Background(), scope)
	if err != nil {
		return result, err
	}
	if err = validateOperationFence(fence); err != nil {
		return result, err
	}
	result.OwnerID = fence.OwnerID
	result.FencingToken = fence.FencingToken
	result.Generation = fence.Generation
	result.Epoch = fence.Epoch
	return result, nil
}

// SetSessionDebugOutput exposes only the bounded structured session logs. It
// does not enable the SDK's general verbose logger. Configure it before the
// first store operation and don't replace it while operations are in flight.
func (c *Container) SetSessionDebugOutput(output func(string)) {
	c.sessionDebugOutput = output
}

// PauseSessionOperationsAndWait closes admission for an exact session/revision
// and waits until every transaction admitted before the fence has completed.
// It is the native write/read quiescence primitive used by provider handoff.
func (c *Container) PauseSessionOperationsAndWait(ctx context.Context, scope SessionScope) error {
	if scope.SessionID == "" || scope.RevisionID <= 0 {
		return errors.New("whatsapp session pause scope is invalid")
	}
	c.operationStateMu.Lock()
	if c.pausedOperations == nil {
		c.pausedOperations = make(map[SessionScope]bool)
	}
	c.pausedOperations[scope] = true
	c.operationStateMu.Unlock()

	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		c.operationStateMu.Lock()
		inFlight := c.inFlightOperations[scope]
		c.operationStateMu.Unlock()
		if inFlight == 0 {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}

func (c *Container) beginSessionOperation(scope SessionScope) bool {
	c.operationStateMu.Lock()
	defer c.operationStateMu.Unlock()
	if c.pausedOperations[scope] {
		return false
	}
	if c.inFlightOperations == nil {
		c.inFlightOperations = make(map[SessionScope]int)
	}
	c.inFlightOperations[scope]++
	return true
}

func (c *Container) endSessionOperation(scope SessionScope) {
	c.operationStateMu.Lock()
	defer c.operationStateMu.Unlock()
	if c.inFlightOperations[scope] <= 1 {
		delete(c.inFlightOperations, scope)
		return
	}
	c.inFlightOperations[scope]--
}

func (c *Container) logSessionDebug(level, event string, scope SessionScope, fields map[string]any) {
	payload := make(map[string]any, len(fields)+3)
	for key, value := range fields {
		payload[key] = value
	}
	payload["session_id"] = scope.SessionID
	payload["revision_id"] = scope.RevisionID
	payload["provider"] = "whatsmeow"
	waLog.WriteSessionDebug(true, event, payload, func(line string) {
		if c.sessionDebugOutput != nil {
			c.sessionDebugOutput(line)
			return
		}
		switch level {
		case "error":
			c.log.Errorf("%s", line)
		case "warn":
			c.log.Warnf("%s", line)
		case "info":
			c.log.Infof("%s", line)
		default:
			c.log.Debugf("%s", line)
		}
	})
}

func (c *Container) recordSessionOperation(scope SessionScope, fence OperationFence, guardDuration, totalDuration time.Duration, operationErr error) {
	now := time.Now()
	isExpectedMiss := errors.Is(operationErr, sql.ErrNoRows)
	guardDurationMS := guardDuration.Milliseconds()
	totalDurationMS := totalDuration.Milliseconds()
	c.operationDebugMu.Lock()
	if c.operationDebug == nil {
		c.operationDebug = make(map[SessionScope]*sessionOperationDebugSummary)
	}
	summary := c.operationDebug[scope]
	first := summary == nil
	if first {
		summary = &sessionOperationDebugSummary{windowStarted: now}
		c.operationDebug[scope] = summary
	}
	summary.operationCount++
	if isExpectedMiss {
		summary.notFoundCount++
	} else if operationErr != nil {
		summary.errorCount++
	}
	summary.totalDurationMS += totalDurationMS
	summary.totalGuardDurationMS += guardDurationMS
	if totalDurationMS > summary.maxDurationMS {
		summary.maxDurationMS = totalDurationMS
	}
	if guardDurationMS > summary.maxGuardDurationMS {
		summary.maxGuardDurationMS = guardDurationMS
	}
	summary.fencingToken = fence.FencingToken
	summary.generation = fence.Generation
	shouldSummarize := now.Sub(summary.windowStarted) >= time.Minute
	var snapshot sessionOperationDebugSummary
	if shouldSummarize {
		snapshot = *summary
		*summary = sessionOperationDebugSummary{windowStarted: now, fencingToken: fence.FencingToken, generation: fence.Generation}
	}
	c.operationDebugMu.Unlock()

	if first {
		c.logSessionDebug("debug", "operation_guard_active", scope, map[string]any{
			"fencing_token": fence.FencingToken,
			"generation":    fence.Generation,
		})
	}
	if shouldSummarize {
		c.logSessionDebug("debug", "operation_guard_summary", scope, map[string]any{
			"fencing_token":           snapshot.fencingToken,
			"generation":              snapshot.generation,
			"operation_count":         snapshot.operationCount,
			"not_found_count":         snapshot.notFoundCount,
			"error_count":             snapshot.errorCount,
			"total_duration_ms":       snapshot.totalDurationMS,
			"max_duration_ms":         snapshot.maxDurationMS,
			"total_guard_duration_ms": snapshot.totalGuardDurationMS,
			"max_guard_duration_ms":   snapshot.maxGuardDurationMS,
			"window_ms":               now.Sub(snapshot.windowStarted).Milliseconds(),
		})
	}
	// Protocol stores intentionally use sql.ErrNoRows to represent an absent
	// identity, ratchet, sender key, app-state key, token, or cache entry. The
	// public getters translate that result to their zero value immediately
	// after Scan returns. Treating these high-volume cache misses as failures
	// hid real store/lease errors behind the debug rate limiter during initial
	// history sync, so aggregate them separately without emitting an error.
	if operationErr != nil && !isExpectedMiss {
		c.logSessionDebug("error", "operation_failed", scope, map[string]any{
			"fencing_token": fence.FencingToken,
			"generation":    fence.Generation,
			"duration_ms":   totalDurationMS,
			"error":         operationErr,
		})
	}
}

type activeSessionOperation struct {
	scope    SessionScope
	mutation bool
}

func (c *Container) doSessionOperation(ctx context.Context, scope SessionScope, fn func(context.Context) error) error {
	return c.doScopedSessionOperation(ctx, scope, false, fn)
}

func (c *Container) doSessionMutation(ctx context.Context, scope SessionScope, fn func(context.Context) error) error {
	return c.doScopedSessionOperation(ctx, scope, true, fn)
}

func (c *Container) doScopedSessionOperation(ctx context.Context, scope SessionScope, mutation bool, fn func(context.Context) error) error {
	if active, ok := ctx.Value(operationScopeContextKey{}).(activeSessionOperation); ok {
		if active.scope != scope {
			return errors.New("nested whatsapp operation attempted to change session scope")
		}
		if mutation && !active.mutation && (c.operationGuard != nil || c.mutationGuard != nil) {
			return ErrSessionMutationInReadTxn
		}
		return fn(ctx)
	}
	if !c.beginSessionOperation(scope) {
		return ErrSessionOperationsPaused
	}
	defer c.endSessionOperation(scope)
	return c.db.DoTxn(ctx, nil, func(txCtx context.Context) error {
		startedAt := time.Now()
		guardDuration := time.Duration(0)
		var fence OperationFence
		guard := c.operationGuard
		if mutation {
			guard = c.mutationGuard
			if guard == nil && c.operationGuard != nil {
				return fmt.Errorf("%w: mutation guard is not configured", ErrOperationGuardRejected)
			}
		}
		if guard != nil {
			var err error
			if c.operationFenceProvider != nil {
				fence, err = c.operationFenceProvider(txCtx, scope)
				if err != nil {
					c.logSessionDebug("error", "operation_fence_failed", scope, map[string]any{"error": err})
					return fmt.Errorf("%w: %v", ErrOperationFenceUnavailable, err)
				}
			}
			guardStartedAt := time.Now()
			if err = guard(txCtx, c.db, scope, fence); err != nil {
				c.logSessionDebug("error", "operation_guard_rejected", scope, map[string]any{
					"fencing_token": fence.FencingToken,
					"generation":    fence.Generation,
					"error":         err,
				})
				return fmt.Errorf("%w: %v", ErrOperationGuardRejected, err)
			}
			guardDuration = time.Since(guardStartedAt)
		}
		err := fn(context.WithValue(txCtx, operationScopeContextKey{}, activeSessionOperation{scope: scope, mutation: mutation}))
		if guard != nil {
			c.recordSessionOperation(scope, fence, guardDuration, time.Since(startedAt), err)
		}
		return err
	})
}

var canonicalSQLiteTablesInDropOrder = [...]string{
	"whatsapp_app_state_mutation_macs",
	"whatsapp_app_state_sync_keys",
	"whatsapp_app_state_version",
	"whatsapp_chat_settings",
	"whatsapp_companion_reservation",
	"whatsapp_contacts",
	"whatsapp_event_buffer",
	"whatsapp_identity_keys",
	"whatsapp_lid_map",
	"whatsapp_message_secrets",
	"whatsapp_nct_salt",
	"whatsapp_pq_pre_key_state",
	"whatsapp_pq_pre_keys",
	"whatsapp_pre_keys",
	"whatsapp_privacy_tokens",
	"whatsapp_provider_record",
	"whatsapp_retry_buffer",
	"whatsapp_sender_keys",
	"whatsapp_signal_sessions",
	"whatsapp_device",
	"whatsapp_session_revision",
	"whatsapp_session",
	"whatsapp_store_version",
}

func (c *Container) sqliteTableExists(ctx context.Context, table string) (bool, error) {
	var count int
	if err := c.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=$1
	`, table).Scan(&count); err != nil {
		return false, err
	}
	return count == 1, nil
}

func (c *Container) readSQLiteVersionCursor(ctx context.Context, table string) (version, compat int, err error) {
	query := fmt.Sprintf(`
		SELECT COUNT(*), COALESCE(MIN(version), 0), COALESCE(MAX(version), 0),
		       COALESCE(MIN(compat), 0), COALESCE(MAX(compat), 0)
		FROM %s
	`, table)
	var count, minimumVersion, maximumVersion, minimumCompat, maximumCompat int
	err = c.db.QueryRow(ctx, query).Scan(
		&count, &minimumVersion, &maximumVersion, &minimumCompat, &maximumCompat,
	)
	if err != nil {
		return 0, 0, err
	} else if count != 1 || minimumVersion != maximumVersion || minimumCompat != maximumCompat {
		return 0, 0, ErrLegacySQLiteVersionUnsupported
	}
	return minimumVersion, minimumCompat, nil
}

// strandedCanonicalSQLiteSessionIsDiscardable recognizes the exact state left
// by an older runtime that opened a legacy database as a fresh canonical
// store. The canonical projection is safe to retire only when its sole
// session never became active: both the session and revision are still
// staging, there is no active/previous revision, and the revision has no
// authoritative source. A ready/active/imported canonical revision remains
// ambiguous and must fail closed even when a paired legacy device exists.
func (c *Container) strandedCanonicalSQLiteSessionIsDiscardable(ctx context.Context) (bool, error) {
	var sessions, revisions, devices, stranded int
	err := c.db.QueryRow(ctx, `
		SELECT
			(SELECT COUNT(*) FROM whatsapp_session),
			(SELECT COUNT(*) FROM whatsapp_session_revision),
			(SELECT COUNT(*) FROM whatsapp_device),
			(
				SELECT COUNT(*)
				FROM whatsapp_session AS session
				INNER JOIN whatsapp_session_revision AS revision
					ON revision.session_id=session.session_id
				INNER JOIN whatsapp_device AS device
					ON device.session_id=revision.session_id
					AND device.revision_id=revision.revision_id
				WHERE session.state='staging'
					AND session.active_revision_id IS NULL
					AND session.previous_revision_id IS NULL
					AND revision.status='staging'
					AND revision.source IS NULL
			)
	`).Scan(&sessions, &revisions, &devices, &stranded)
	if err != nil {
		return false, err
	}
	return sessions == 1 && revisions == 1 && devices == 1 && stranded == 1, nil
}

// prepareLegacySQLiteUpgrade adopts the version cursor used by pre-session
// WhatsMeow stores. The generic cursor was introduced for the shared canonical
// schema. Without this bridge, a legacy SQLite database is treated as a fresh
// v17 store: its whatsmeow_* credentials remain intact but become invisible to
// GetFirstDevice, which then incorrectly starts a new QR flow.
//
// Some runtimes have already opened such databases once and therefore contain
// an empty v17 whatsapp_* schema next to the valid legacy projection. That
// exact state is repaired by removing only the proven-empty canonical schema,
// adopting the v14/v15 cursor, and letting the existing v15 -> v17 migrations
// perform the data conversion. Any populated or multi-device state remains
// fail-closed.
func (c *Container) prepareLegacySQLiteUpgrade(ctx context.Context) error {
	legacyCursorExists, err := c.sqliteTableExists(ctx, "whatsmeow_version")
	if err != nil || !legacyCursorExists {
		return err
	}
	legacyDeviceExists, err := c.sqliteTableExists(ctx, "whatsmeow_device")
	if err != nil {
		return err
	} else if !legacyDeviceExists {
		return ErrLegacySQLiteVersionUnsupported
	}
	legacyVersion, legacyCompat, err := c.readSQLiteVersionCursor(ctx, "whatsmeow_version")
	if err != nil {
		return fmt.Errorf("%w: %v", ErrLegacySQLiteVersionUnsupported, err)
	} else if (legacyVersion != 14 && legacyVersion != 15) || legacyCompat <= 0 || legacyCompat > legacyVersion {
		return ErrLegacySQLiteVersionUnsupported
	}
	var pairedLegacyDevices int
	if err = c.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM whatsmeow_device WHERE jid IS NOT NULL AND TRIM(jid) <> ''
	`).Scan(&pairedLegacyDevices); err != nil {
		return fmt.Errorf("inspect legacy sqlite devices: %w", err)
	} else if pairedLegacyDevices == 0 {
		return nil
	} else if pairedLegacyDevices != 1 {
		return ErrLegacySQLiteSessionAmbiguous
	}

	canonicalCursorExists, err := c.sqliteTableExists(ctx, "whatsapp_store_version")
	if err != nil {
		return err
	}
	if !canonicalCursorExists {
		var partialCanonicalTables int
		if err = c.db.QueryRow(ctx, `
			SELECT COUNT(*) FROM sqlite_master
			WHERE type='table' AND name GLOB 'whatsapp_*'
		`).Scan(&partialCanonicalTables); err != nil {
			return fmt.Errorf("inspect partial canonical sqlite schema: %w", err)
		} else if partialCanonicalTables != 0 {
			return ErrLegacySQLiteSessionAmbiguous
		}
		return c.db.DoTxn(ctx, nil, func(txCtx context.Context) error {
			if _, txErr := c.db.Exec(txCtx, `ALTER TABLE whatsmeow_version RENAME TO whatsapp_store_version`); txErr != nil {
				return fmt.Errorf("adopt legacy sqlite version cursor: %w", txErr)
			}
			return nil
		})
	}

	canonicalVersion, canonicalCompat, err := c.readSQLiteVersionCursor(ctx, "whatsapp_store_version")
	if err != nil || canonicalVersion != SharedSchemaVersion || canonicalCompat != SharedSchemaVersion {
		return ErrLegacySQLiteSessionAmbiguous
	}
	canonicalEmpty := true
	for _, table := range canonicalSQLiteTablesInDropOrder {
		if table == "whatsapp_store_version" {
			continue
		}
		exists, tableErr := c.sqliteTableExists(ctx, table)
		if tableErr != nil || !exists {
			return ErrLegacySQLiteSessionAmbiguous
		}
		query := fmt.Sprintf("SELECT COUNT(*) FROM %s", table)
		var count int
		if tableErr = c.db.QueryRow(ctx, query).Scan(&count); tableErr != nil {
			return fmt.Errorf("inspect canonical sqlite session table: %w", tableErr)
		} else if count != 0 {
			canonicalEmpty = false
		}
	}
	if !canonicalEmpty {
		discardable, discardErr := c.strandedCanonicalSQLiteSessionIsDiscardable(ctx)
		if discardErr != nil {
			return fmt.Errorf("inspect stranded canonical sqlite session: %w", discardErr)
		} else if !discardable {
			return ErrLegacySQLiteSessionAmbiguous
		}
	}

	return c.db.DoTxn(ctx, nil, func(txCtx context.Context) error {
		for _, table := range canonicalSQLiteTablesInDropOrder {
			if _, txErr := c.db.Exec(txCtx, "DROP TABLE IF EXISTS "+table); txErr != nil {
				return fmt.Errorf("remove empty canonical sqlite table: %w", txErr)
			}
		}
		if _, txErr := c.db.Exec(txCtx, `ALTER TABLE whatsmeow_version RENAME TO whatsapp_store_version`); txErr != nil {
			return fmt.Errorf("adopt stranded legacy sqlite version cursor: %w", txErr)
		}
		return nil
	})
}

// Upgrade upgrades the database from the current to the latest version available.
func (c *Container) Upgrade(ctx context.Context) error {
	if c.db.Dialect == dbutil.SQLite {
		var foreignKeysEnabled bool
		err := c.db.QueryRow(ctx, "PRAGMA foreign_keys").Scan(&foreignKeysEnabled)
		if err != nil {
			return fmt.Errorf("failed to check if foreign keys are enabled: %w", err)
		} else if !foreignKeysEnabled {
			return fmt.Errorf("foreign keys are not enabled")
		}
		if err = c.prepareLegacySQLiteUpgrade(ctx); err != nil {
			return fmt.Errorf("prepare legacy sqlite session upgrade: %w", err)
		}
	}

	if err := c.db.Upgrade(ctx); err != nil {
		return err
	}
	if c.db.Dialect == dbutil.SQLite {
		if err := c.normalizeLegacySQLiteADVSecret(ctx); err != nil {
			return fmt.Errorf("normalize legacy sqlite ADV secret: %w", err)
		}
	}
	return nil
}

// normalizeLegacySQLiteADVSecret repairs a representation emitted by the
// immutable v16 -> v17 migration. Some pre-session SQLite stores persisted a
// missing ADV secret as a non-NULL, zero-length blob. The migration inferred
// availability from NULL-ness alone, so those otherwise valid paired devices
// became impossible to load after the stricter canonical codec validation.
// The empty blob is retained as the storage sentinel because SQLite stores
// upgraded from v15 still carry the old all-credentials-present CHECK, which
// does not allow adv_key to become NULL on a paired device.
//
// Keep this repair deliberately narrow: only revisions proven to originate
// from the legacy SQLite importer are normalized. Canonical v17 corruption
// must continue to fail closed.
func (c *Container) normalizeLegacySQLiteADVSecret(ctx context.Context) error {
	return c.db.DoTxn(ctx, nil, func(txCtx context.Context) error {
		_, err := c.db.Exec(txCtx, `
			UPDATE whatsapp_device AS device
			SET adv_secret_available=false
			WHERE device.adv_secret_available=true
				AND device.adv_key IS NOT NULL
				AND length(device.adv_key)=0
				AND EXISTS (
					SELECT 1
					FROM whatsapp_session_revision AS revision
					WHERE revision.session_id=device.session_id
						AND revision.revision_id=device.revision_id
						AND revision.source='legacy_sqlite'
				)
		`)
		return err
	})
}

// ValidateSchemaVersion verifies the externally managed schema without
// executing DDL.
func (c *Container) ValidateSchemaVersion(ctx context.Context, expected int) error {
	var count, minimum, maximum int
	if err := c.db.QueryRow(ctx, `
		SELECT COUNT(*), COALESCE(MIN(version), 0), COALESCE(MAX(version), 0)
		FROM whatsapp_store_version
	`).Scan(&count, &minimum, &maximum); err != nil {
		return fmt.Errorf("failed to read whatsapp schema version: %w", err)
	}
	if count != 1 || minimum != expected || maximum != expected {
		return fmt.Errorf("unsupported whatsapp schema version: rows=%d range=v%d..v%d, expected exactly v%d", count, minimum, maximum, expected)
	}
	return nil
}

const getAllDevicesQuery = `
SELECT session_id, revision_id, jid, lid, registration_id, noise_key, identity_key,
       signed_pre_key, signed_pre_key_id, signed_pre_key_sig,
       adv_key, adv_secret_available, adv_details, adv_account_sig,
       adv_account_sig_key, adv_device_sig,
       platform, business_name, push_name, facebook_uuid, lid_migration_ts,
       device_fingerprint, fingerprint_version, next_pre_key_id
FROM whatsapp_device
`

const getDeviceQuery = getAllDevicesQuery + " WHERE jid=$1 ORDER BY session_id, revision_id LIMIT 2"
const getDeviceForSessionQuery = getAllDevicesQuery + " WHERE session_id=$1 AND revision_id=$2"

// ValidateDeviceKeyMaterial verifies all three local X25519 key pairs and the
// identity signature over the typed signed pre-key. Errors are stable codes
// and intentionally contain no key material or account identifiers.
func ValidateDeviceKeyMaterial(device *store.Device) error {
	if device == nil || device.NoiseKey == nil || device.IdentityKey == nil ||
		device.SignedPreKey == nil || device.SignedPreKey.Signature == nil {
		return ErrDeviceKeyMaterialInvalid
	}
	pairs := []*keys.KeyPair{device.NoiseKey, device.IdentityKey, &device.SignedPreKey.KeyPair}
	for _, pair := range pairs {
		if pair == nil || pair.Priv == nil || pair.Pub == nil {
			return ErrDeviceKeyMaterialInvalid
		}
		derived := keys.NewKeyPairFromPrivateKey(*pair.Priv)
		if derived.Pub == nil || subtle.ConstantTimeCompare(derived.Pub[:], pair.Pub[:]) != 1 {
			return ErrDeviceKeyPairMismatch
		}
	}

	var signedPreKeyMessage [33]byte
	signedPreKeyMessage[0] = ecc.DjbType
	copy(signedPreKeyMessage[1:], device.SignedPreKey.Pub[:])
	if !ecc.VerifySignature(
		ecc.NewDjbECPublicKey(*device.IdentityKey.Pub),
		signedPreKeyMessage[:],
		*device.SignedPreKey.Signature,
	) {
		return ErrSignedPreKeySignatureInvalid
	}
	return nil
}

// ValidateCanonicalDeviceKeyMaterial validates the private-only canonical
// database representation before it is restored or copied into a revision.
func ValidateCanonicalDeviceKeyMaterial(noisePrivate, identityPrivate, signedPreKeyPrivate, signature []byte) error {
	if len(noisePrivate) != 32 || len(identityPrivate) != 32 ||
		len(signedPreKeyPrivate) != 32 || len(signature) != 64 {
		return ErrDeviceKeyMaterialInvalid
	}
	noiseKey := keys.NewKeyPairFromPrivateKey(*(*[32]byte)(noisePrivate))
	identityKey := keys.NewKeyPairFromPrivateKey(*(*[32]byte)(identityPrivate))
	signedPreKey := &keys.PreKey{
		KeyPair:   *keys.NewKeyPairFromPrivateKey(*(*[32]byte)(signedPreKeyPrivate)),
		Signature: (*[64]byte)(signature),
	}
	return ValidateDeviceKeyMaterial(&store.Device{
		NoiseKey:     noiseKey,
		IdentityKey:  identityKey,
		SignedPreKey: signedPreKey,
	})
}

func (c *Container) scanDevice(row dbutil.Scannable) (*store.Device, error) {
	var device store.Device
	device.Log = c.log
	var noisePriv, identityPriv, preKeyPriv, preKeySig, deviceFingerprint []byte
	var account waAdv.ADVSignedDeviceIdentity
	var fbUUID uuid.NullUUID
	var sessionID sql.NullString
	var jid sql.NullString
	var registrationID, signedPreKeyID sql.NullInt64
	var fingerprintVersion sql.NullString

	err := row.Scan(
		&sessionID, &device.RevisionID, &jid, &device.LID, &registrationID, &noisePriv, &identityPriv,
		&preKeyPriv, &signedPreKeyID, &preKeySig,
		&device.AdvSecretKey, &device.AdvSecretAvailable, &account.Details, &account.AccountSignature, &account.AccountSignatureKey, &account.DeviceSignature,
		&device.Platform, &device.BusinessName, &device.PushName, &fbUUID, &device.LIDMigrationTimestamp,
		&deviceFingerprint, &fingerprintVersion, &device.NextPreKeyID)
	if err != nil {
		return nil, fmt.Errorf("failed to scan session: %w", err)
	}

	credentialPresence := [...]bool{
		registrationID.Valid,
		noisePriv != nil,
		identityPriv != nil,
		preKeyPriv != nil,
		signedPreKeyID.Valid,
		preKeySig != nil,
		account.Details != nil,
		account.AccountSignature != nil,
		account.AccountSignatureKey != nil,
		account.DeviceSignature != nil,
	}
	allAbsent, allPresent := true, true
	for _, present := range credentialPresence {
		allAbsent = allAbsent && !present
		allPresent = allPresent && present
	}
	if allAbsent {
		return nil, ErrDeviceCredentialsUnavailable
	} else if !allPresent {
		return nil, ErrIncompleteDeviceCredentials
	} else if (device.AdvSecretAvailable && len(device.AdvSecretKey) != 32) ||
		(!device.AdvSecretAvailable && len(device.AdvSecretKey) != 0) {
		return nil, ErrIncompleteDeviceCredentials
	} else if registrationID.Int64 < 0 || registrationID.Int64 >= 1<<32 || signedPreKeyID.Int64 < 0 || signedPreKeyID.Int64 >= 1<<24 {
		return nil, ErrInvalidLength
	} else if len(noisePriv) != 32 || len(identityPriv) != 32 || len(preKeyPriv) != 32 || len(preKeySig) != 64 ||
		len(account.AccountSignature) != 64 || len(account.AccountSignatureKey) != 32 || len(account.DeviceSignature) != 64 {
		return nil, ErrInvalidLength
	}

	if jid.Valid {
		parsedJID, parseErr := types.ParseJID(jid.String)
		if parseErr != nil {
			return nil, fmt.Errorf("failed to parse device JID: %w", parseErr)
		}
		device.ID = &parsedJID
	}

	device.NoiseKey = keys.NewKeyPairFromPrivateKey(*(*[32]byte)(noisePriv))
	device.IdentityKey = keys.NewKeyPairFromPrivateKey(*(*[32]byte)(identityPriv))
	device.RegistrationID = uint32(registrationID.Int64)
	device.SignedPreKey = &keys.PreKey{
		KeyPair:   *keys.NewKeyPairFromPrivateKey(*(*[32]byte)(preKeyPriv)),
		KeyID:     uint32(signedPreKeyID.Int64),
		Signature: (*[64]byte)(preKeySig),
	}
	if err = ValidateDeviceKeyMaterial(&device); err != nil {
		return nil, err
	}
	device.Account = &account
	device.FacebookUUID = fbUUID.UUID
	device.SessionID = sessionID.String
	if len(deviceFingerprint) == 0 {
		device.DeviceFingerprint = CalculateDeviceFingerprint(&device)
	} else if len(deviceFingerprint) != len(device.DeviceFingerprint) {
		return nil, ErrInvalidLength
	} else if !fingerprintVersion.Valid || fingerprintVersion.String != DeviceFingerprintVersion {
		return nil, ErrIncompleteDeviceCredentials
	} else {
		copy(device.DeviceFingerprint[:], deviceFingerprint)
	}
	device.FingerprintVersion = DeviceFingerprintVersion

	c.initializeDevice(&device)

	return &device, nil
}

// GetAllDevices finds all the devices in the database.
func (c *Container) GetAllDevices(ctx context.Context) ([]*store.Device, error) {
	if c.db.Dialect == dbutil.Postgres {
		return nil, ErrAmbiguousDeviceLookup
	}
	res, err := c.db.Query(ctx, getAllDevicesQuery)
	devices, err := dbutil.NewRowIterWithError(res, c.scanDevice, err).AsList()
	if err != nil {
		return nil, err
	}
	for _, device := range devices {
		if err = c.normalizeCanonicalSignalStorage(ctx, SessionScope{SessionID: device.SessionID, RevisionID: device.RevisionID}); err != nil {
			return nil, err
		}
	}
	return devices, nil
}

// GetFirstDevice is a convenience method for getting the first device in the store. If there are
// no devices, then a new device will be created. You should only use this if you don't want to
// have multiple sessions simultaneously.
func (c *Container) GetFirstDevice(ctx context.Context) (*store.Device, error) {
	if c.db.Dialect == dbutil.Postgres {
		return nil, ErrAmbiguousDeviceLookup
	}
	devices, err := c.GetAllDevices(ctx)
	if err != nil {
		return nil, err
	}
	if len(devices) == 0 {
		return c.NewDevice(), nil
	} else {
		return devices[0], nil
	}
}

// GetDeviceForSession returns the device owned by the exact session revision.
// If the revision has not been paired yet, it returns a new device bound to
// that scope. Shared databases must use this method instead of JID lookups.
func (c *Container) GetDeviceForSession(ctx context.Context, sessionID string, revisionID int64) (*store.Device, error) {
	if sessionID == "" {
		return nil, ErrSessionIDRequired
	} else if _, err := uuid.Parse(sessionID); err != nil {
		return nil, ErrInvalidSessionID
	}
	if revisionID <= 0 {
		return nil, ErrRevisionIDRequired
	}
	var device *store.Device
	err := c.doSessionOperation(ctx, SessionScope{SessionID: sessionID, RevisionID: revisionID}, func(txCtx context.Context) error {
		var scanErr error
		device, scanErr = c.scanDevice(c.db.QueryRow(txCtx, getDeviceForSessionQuery, sessionID, revisionID))
		return scanErr
	})
	if errors.Is(err, sql.ErrNoRows) {
		c.logSessionDebug("info", "device_scope_created", SessionScope{SessionID: sessionID, RevisionID: revisionID}, nil)
		return c.NewDeviceForSession(sessionID, revisionID), nil
	} else if errors.Is(err, ErrDeviceCredentialsUnavailable) || errors.Is(err, ErrIncompleteDeviceCredentials) {
		c.logSessionDebug("error", "device_credentials_rejected", SessionScope{SessionID: sessionID, RevisionID: revisionID}, map[string]any{
			"error": err,
		})
	}
	if err == nil {
		err = c.normalizeCanonicalSignalStorage(ctx, SessionScope{SessionID: sessionID, RevisionID: revisionID})
		if err != nil {
			return nil, err
		}
	}
	return device, err
}

// GetDevice finds the device with the specified JID in the database.
//
// If the device is not found, nil is returned instead.
//
// Note that the parameter usually must be an AD-JID.
func (c *Container) GetDevice(ctx context.Context, jid types.JID) (*store.Device, error) {
	if c.db.Dialect == dbutil.Postgres {
		return nil, ErrAmbiguousDeviceLookup
	}
	rows, err := c.db.Query(ctx, getDeviceQuery, jid)
	devices, err := dbutil.NewRowIterWithError(rows, c.scanDevice, err).AsList()
	if err != nil {
		return nil, err
	} else if len(devices) == 0 {
		return nil, nil
	} else if len(devices) > 1 {
		return nil, ErrAmbiguousDeviceLookup
	}
	if err = c.normalizeCanonicalSignalStorage(ctx, SessionScope{SessionID: devices[0].SessionID, RevisionID: devices[0].RevisionID}); err != nil {
		return nil, err
	}
	return devices[0], nil
}

type signalStorageUpdate struct {
	firstKey  string
	secondKey string
	payload   []byte
}

func (c *Container) normalizeCanonicalSignalStorage(ctx context.Context, scope SessionScope) error {
	var sessionUpdates, senderUpdates []signalStorageUpdate
	err := c.doSessionMutation(ctx, scope, func(txCtx context.Context) error {
		sessionRows, err := c.db.Query(txCtx, `
			SELECT their_id, session
			FROM whatsapp_signal_sessions
			WHERE session_id=$1 AND revision_id=$2 AND scope='default'
		`, scope.SessionID, scope.RevisionID)
		if err != nil {
			return err
		}
		for sessionRows.Next() {
			var theirID string
			var payload []byte
			if err = sessionRows.Scan(&theirID, &payload); err != nil {
				_ = sessionRows.Close()
				return err
			}
			if payload == nil {
				continue
			}
			canonical, normalizeErr := store.NormalizeSignalSessionStorage(payload)
			if normalizeErr != nil {
				_ = sessionRows.Close()
				return fmt.Errorf("normalize Signal session storage: %w", normalizeErr)
			}
			if !bytes.Equal(canonical, payload) {
				sessionUpdates = append(sessionUpdates, signalStorageUpdate{firstKey: theirID, payload: canonical})
			}
		}
		if err = sessionRows.Err(); err != nil {
			_ = sessionRows.Close()
			return err
		}
		if err = sessionRows.Close(); err != nil {
			return err
		}

		senderRows, err := c.db.Query(txCtx, `
			SELECT chat_id, sender_id, sender_key
			FROM whatsapp_sender_keys
			WHERE session_id=$1 AND revision_id=$2
		`, scope.SessionID, scope.RevisionID)
		if err != nil {
			return err
		}
		for senderRows.Next() {
			var chatID, senderID string
			var payload []byte
			if err = senderRows.Scan(&chatID, &senderID, &payload); err != nil {
				_ = senderRows.Close()
				return err
			}
			canonical, normalizeErr := store.NormalizeSenderKeyStorage(payload)
			if normalizeErr != nil {
				_ = senderRows.Close()
				return fmt.Errorf("normalize sender-key storage: %w", normalizeErr)
			}
			if !bytes.Equal(canonical, payload) {
				senderUpdates = append(senderUpdates, signalStorageUpdate{
					firstKey: chatID, secondKey: senderID, payload: canonical,
				})
			}
		}
		if err = senderRows.Err(); err != nil {
			_ = senderRows.Close()
			return err
		}
		if err = senderRows.Close(); err != nil {
			return err
		}

		if c.db.Dialect == dbutil.Postgres {
			if PostgresArrayWrapper == nil {
				return errors.New("PostgresArrayWrapper is required for canonical Signal storage normalization")
			}
			if len(sessionUpdates) > 0 {
				ids, payloads := make([]string, len(sessionUpdates)), make([][]byte, len(sessionUpdates))
				for index, update := range sessionUpdates {
					ids[index], payloads[index] = update.firstKey, update.payload
				}
				if _, err = c.db.Exec(txCtx, `
					UPDATE whatsapp_signal_sessions AS target
					SET session=input.payload
					FROM unnest($3::text[], $4::bytea[]) AS input(their_id, payload)
					WHERE target.session_id=$1 AND target.revision_id=$2
					  AND target.scope='default' AND target.their_id=input.their_id
				`, scope.SessionID, scope.RevisionID,
					PostgresArrayWrapper(ids), PostgresArrayWrapper(payloads)); err != nil {
					return err
				}
			}
			if len(senderUpdates) > 0 {
				chatIDs, senderIDs := make([]string, len(senderUpdates)), make([]string, len(senderUpdates))
				payloads := make([][]byte, len(senderUpdates))
				for index, update := range senderUpdates {
					chatIDs[index], senderIDs[index], payloads[index] = update.firstKey, update.secondKey, update.payload
				}
				if _, err = c.db.Exec(txCtx, `
					UPDATE whatsapp_sender_keys AS target
					SET sender_key=input.payload
					FROM unnest($3::text[], $4::text[], $5::bytea[])
					  AS input(chat_id, sender_id, payload)
					WHERE target.session_id=$1 AND target.revision_id=$2
					  AND target.chat_id=input.chat_id AND target.sender_id=input.sender_id
				`, scope.SessionID, scope.RevisionID,
					PostgresArrayWrapper(chatIDs), PostgresArrayWrapper(senderIDs), PostgresArrayWrapper(payloads)); err != nil {
					return err
				}
			}
			return nil
		}

		for _, update := range sessionUpdates {
			if _, err = c.db.Exec(txCtx, `
				UPDATE whatsapp_signal_sessions SET session=$4
				WHERE session_id=$1 AND revision_id=$2 AND scope='default' AND their_id=$3
			`, scope.SessionID, scope.RevisionID, update.firstKey, update.payload); err != nil {
				return err
			}
		}
		for _, update := range senderUpdates {
			if _, err = c.db.Exec(txCtx, `
				UPDATE whatsapp_sender_keys SET sender_key=$5
				WHERE session_id=$1 AND revision_id=$2 AND chat_id=$3 AND sender_id=$4
			`, scope.SessionID, scope.RevisionID, update.firstKey, update.secondKey, update.payload); err != nil {
				return err
			}
		}
		return nil
	})
	if err == nil && (len(sessionUpdates) > 0 || len(senderUpdates) > 0) {
		c.logSessionDebug("info", "signal_storage_normalized", scope, map[string]any{
			"session_records": len(sessionUpdates),
			"sender_records":  len(senderUpdates),
		})
	}
	return err
}

const (
	insertDeviceQuery = `
		INSERT INTO whatsapp_device (session_id, revision_id, jid, lid, registration_id, noise_key, identity_key,
									  signed_pre_key, signed_pre_key_id, signed_pre_key_sig,
									  adv_key, adv_secret_available, adv_details, adv_account_sig, adv_account_sig_key, adv_device_sig,
									  platform, business_name, push_name, facebook_uuid, lid_migration_ts,
									  device_fingerprint, fingerprint_version, next_pre_key_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
		ON CONFLICT (session_id, revision_id) DO UPDATE
			SET jid=excluded.jid,
				lid=excluded.lid,
				device_fingerprint=excluded.device_fingerprint,
				fingerprint_version=excluded.fingerprint_version,
				adv_secret_available=excluded.adv_secret_available,
				platform=excluded.platform,
				business_name=excluded.business_name,
				push_name=excluded.push_name,
				lid_migration_ts=excluded.lid_migration_ts
	`
	deleteDeviceQuery    = `DELETE FROM whatsapp_device WHERE session_id=$1 AND revision_id=$2`
	lockDeviceScopeQuery = `SELECT 1 FROM whatsapp_device WHERE session_id=$1 AND revision_id=$2`
)

// NewDevice creates a new device in this database.
//
// No data is actually stored before Save is called. However, the pairing process will automatically
// call Save after a successful pairing, so you most likely don't need to call it yourself.
func (c *Container) NewDevice() *store.Device {
	return c.NewDeviceForSession(uuid.NewString(), 1)
}

// NewDeviceForSession creates an unpersisted device owned by the exact scope.
func (c *Container) NewDeviceForSession(sessionID string, revisionID int64) *store.Device {
	device := &store.Device{
		Log:        c.log,
		SessionID:  sessionID,
		RevisionID: revisionID,
		Container:  c,

		NoiseKey:           keys.NewKeyPair(),
		IdentityKey:        keys.NewKeyPair(),
		RegistrationID:     mathRand.Uint32(),
		AdvSecretKey:       random.Bytes(32),
		AdvSecretAvailable: true,
		FingerprintVersion: DeviceFingerprintVersion,
		NextPreKeyID:       1,
	}
	device.SignedPreKey = device.IdentityKey.CreateSignedPreKey(1)
	// Edge-routing can arrive before pairing has assigned a JID and persisted
	// the device. Expose only the revision-scoped transport store immediately;
	// protocol stores remain unavailable until PutDevice establishes the device
	// FK and initializeDevice installs the complete SQLStore.
	device.Transport = NewSQLStore(c, sessionID, revisionID)
	return device
}

// ErrDeviceIDMustBeSet is the error returned by PutDevice if you try to save a device before knowing its JID.
var ErrDeviceIDMustBeSet = errors.New("device JID must be known before accessing database")

var (
	ErrSessionIDRequired            = errors.New("session ID is required")
	ErrInvalidSessionID             = errors.New("session ID must be a UUID")
	ErrRevisionIDRequired           = errors.New("revision ID must be greater than zero")
	ErrAmbiguousDeviceLookup        = errors.New("ambiguous device lookup is disabled; use session ID and revision ID")
	ErrDeviceCredentialsUnavailable = errors.New("whatsmeow credentials are unavailable for this session revision")
	ErrIncompleteDeviceCredentials  = errors.New("whatsmeow credentials are incomplete for this session revision")
	ErrDeviceKeyMaterialInvalid     = errors.New("whatsmeow_device_key_material_invalid")
	ErrDeviceKeyPairMismatch        = errors.New("whatsmeow_device_key_pair_mismatch")
	ErrSignedPreKeySignatureInvalid = errors.New("whatsmeow_signed_pre_key_signature_invalid")
	ErrCompanionIdentityConflict    = errors.New("whatsapp companion identity is reserved by another session")
)

// Close will close the container's database
func (c *Container) Close() error {
	if c != nil && c.db != nil {
		return c.db.Close()
	}
	return nil
}

// PutDevice stores the given device in this database. This should be called through Device.Save()
// (which usually doesn't need to be called manually, as the library does that automatically when relevant).
func (c *Container) PutDevice(ctx context.Context, device *store.Device) error {
	if device.ID == nil {
		return ErrDeviceIDMustBeSet
	} else if device.SessionID == "" {
		return ErrSessionIDRequired
	} else if _, err := uuid.Parse(device.SessionID); err != nil {
		return ErrInvalidSessionID
	} else if device.RevisionID <= 0 {
		return ErrRevisionIDRequired
	}
	if err := ValidateDeviceKeyMaterial(device); err != nil {
		return err
	}
	if c.operationGuard == nil && c.mutationGuard == nil {
		if err := c.ensureStandaloneSessionRevision(ctx, device.SessionID, device.RevisionID); err != nil {
			return err
		}
	}
	if len(device.AdvSecretKey) != 0 && len(device.AdvSecretKey) != 32 {
		return ErrInvalidLength
	}
	if len(device.AdvSecretKey) == 0 {
		device.AdvSecretKey = nil
	}
	device.DeviceFingerprint = CalculateDeviceFingerprint(device)
	device.AdvSecretAvailable = len(device.AdvSecretKey) == 32
	device.FingerprintVersion = DeviceFingerprintVersion
	if device.NextPreKeyID == 0 {
		device.NextPreKeyID = 1
	}
	var persistedADVSecret any
	if device.AdvSecretAvailable {
		persistedADVSecret = device.AdvSecretKey
	}
	err := c.doSessionMutation(ctx, SessionScope{SessionID: device.SessionID, RevisionID: device.RevisionID}, func(txCtx context.Context) error {
		if c.operationGuard == nil && c.mutationGuard == nil {
			if reserveErr := c.reserveStandaloneCompanionIdentity(txCtx, device.SessionID, device.DeviceFingerprint[:]); reserveErr != nil {
				return reserveErr
			}
		}
		_, execErr := c.db.Exec(txCtx, insertDeviceQuery,
			device.SessionID, device.RevisionID, device.ID, device.LID, device.RegistrationID, device.NoiseKey.Priv[:], device.IdentityKey.Priv[:],
			device.SignedPreKey.Priv[:], device.SignedPreKey.KeyID, device.SignedPreKey.Signature[:],
			persistedADVSecret, device.AdvSecretAvailable, device.Account.Details, device.Account.AccountSignature, device.Account.AccountSignatureKey, device.Account.DeviceSignature,
			device.Platform, device.BusinessName, device.PushName, uuid.NullUUID{UUID: device.FacebookUUID, Valid: device.FacebookUUID != uuid.Nil},
			device.LIDMigrationTimestamp, device.DeviceFingerprint[:], device.FingerprintVersion, device.NextPreKeyID,
		)
		return execErr
	})
	if !device.Initialized {
		c.initializeDevice(device)
	}
	if err == nil {
		c.logSessionDebug("info", "device_saved", SessionScope{SessionID: device.SessionID, RevisionID: device.RevisionID}, nil)
	}
	return err
}

// ReserveCompanionIdentity establishes the global v2 identity reservation
// before an already-paired client opens its socket. Shared PostgreSQL stores
// reserve through the whatsapp_device trigger under the fenced/RLS operation;
// standalone PostgreSQL and SQLite stores use the same write-once reservation
// table directly. Reconnecting the same session never updates the reservation
// row, so its tuple remains stable and produces no heartbeat-style WAL churn.
func (c *Container) ReserveCompanionIdentity(ctx context.Context, device *store.Device) error {
	if device == nil || device.ID == nil {
		return ErrDeviceIDMustBeSet
	} else if device.SessionID == "" {
		return ErrSessionIDRequired
	} else if _, err := uuid.Parse(device.SessionID); err != nil {
		return ErrInvalidSessionID
	} else if device.RevisionID <= 0 {
		return ErrRevisionIDRequired
	} else if device.IdentityKey == nil || device.Account == nil {
		return ErrIncompleteDeviceCredentials
	}

	device.DeviceFingerprint = CalculateDeviceFingerprint(device)
	device.FingerprintVersion = DeviceFingerprintVersion
	scope := SessionScope{SessionID: device.SessionID, RevisionID: device.RevisionID}
	return c.doSessionMutation(ctx, scope, func(txCtx context.Context) error {
		if c.operationGuard == nil && c.mutationGuard == nil {
			if err := c.reserveStandaloneCompanionIdentity(txCtx, device.SessionID, device.DeviceFingerprint[:]); err != nil {
				return err
			}
		}

		// Executing the scoped UPDATE before the caller opens a socket also
		// invokes the shared PostgreSQL reservation trigger. The reservation
		// function itself is write-once for an already-owned fingerprint.
		result, err := c.db.Exec(txCtx, `
			UPDATE whatsapp_device
			SET device_fingerprint=$3, fingerprint_version=$4
			WHERE session_id=$1 AND revision_id=$2
		`, device.SessionID, device.RevisionID, device.DeviceFingerprint[:], DeviceFingerprintVersion)
		if err != nil {
			return fmt.Errorf("failed to persist companion reservation fingerprint: %w", err)
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return err
		} else if affected != 1 {
			return ErrDeviceCredentialsUnavailable
		}
		return nil
	})
}

func (c *Container) reserveStandaloneCompanionIdentity(ctx context.Context, sessionID string, fingerprint []byte) error {
	if len(fingerprint) != sha256.Size {
		return ErrIncompleteDeviceCredentials
	}
	if _, err := c.db.Exec(ctx, `
		INSERT INTO whatsapp_companion_reservation (
			fingerprint_version, device_fingerprint, session_id
		) VALUES ($1, $2, $3)
		ON CONFLICT DO NOTHING
	`, DeviceFingerprintVersion, fingerprint, sessionID); err != nil {
		return fmt.Errorf("failed to reserve companion identity: %w", err)
	}

	var reservedSessionID string
	err := c.db.QueryRow(ctx, `
		SELECT session_id
		FROM whatsapp_companion_reservation
		WHERE fingerprint_version=$1 AND device_fingerprint=$2
	`, DeviceFingerprintVersion, fingerprint).Scan(&reservedSessionID)
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("%w: session already reserves another identity", ErrCompanionIdentityConflict)
	} else if err != nil {
		return fmt.Errorf("failed to verify companion identity reservation: %w", err)
	} else if reservedSessionID != sessionID {
		return ErrCompanionIdentityConflict
	}
	return nil
}

// CalculateDeviceFingerprint returns a deterministic, versioned SHA-256 hash
// of the companion identity fields shared by all provider codecs. The raw
// credentials are never logged or exposed by this function.
func CalculateDeviceFingerprint(device *store.Device) [32]byte {
	hasher := sha256.New()
	_, _ = hasher.Write([]byte(DeviceFingerprintVersion))
	writeField := func(value []byte) {
		var length [4]byte
		binary.BigEndian.PutUint32(length[:], uint32(len(value)))
		_, _ = hasher.Write(length[:])
		_, _ = hasher.Write(value)
	}
	if device != nil && device.IdentityKey != nil && device.IdentityKey.Pub != nil {
		writeField(device.IdentityKey.Pub[:])
	} else {
		writeField(nil)
	}
	if device != nil {
		if device.Account != nil {
			writeField(device.Account.Details)
			writeField(device.Account.AccountSignatureKey)
			writeField(device.Account.AccountSignature)
			writeField(device.Account.DeviceSignature)
		} else {
			writeField(nil)
			writeField(nil)
			writeField(nil)
			writeField(nil)
		}
	}
	var fingerprint [32]byte
	copy(fingerprint[:], hasher.Sum(nil))
	return fingerprint
}

func (c *Container) ensureStandaloneSessionRevision(ctx context.Context, sessionID string, revisionID int64) error {
	if _, err := c.db.Exec(ctx, `
		INSERT INTO whatsapp_session (session_id, provider, state, generation)
		VALUES ($1, 'whatsmeow', 'staging', 1)
		ON CONFLICT (session_id) DO NOTHING
	`, sessionID); err != nil {
		return fmt.Errorf("failed to ensure standalone whatsapp session: %w", err)
	}
	if _, err := c.db.Exec(ctx, `
		INSERT INTO whatsapp_session_revision (session_id, revision_id, provider, status, schema_version, codec_version)
		VALUES ($1, $2, 'whatsmeow', 'staging', $3, 1)
		ON CONFLICT (session_id, revision_id) DO NOTHING
	`, sessionID, revisionID, SharedSchemaVersion); err != nil {
		return fmt.Errorf("failed to ensure standalone whatsapp session revision: %w", err)
	}
	return nil
}

func (c *Container) initializeDevice(device *store.Device) {
	innerStore, ok := device.Transport.(*SQLStore)
	if !ok || innerStore.Container != c || innerStore.SessionID != device.SessionID || innerStore.RevisionID != device.RevisionID {
		innerStore = NewSQLStore(c, device.SessionID, device.RevisionID)
	}
	device.SetAllStores(innerStore)
	device.LIDs = innerStore.LIDMap
	device.Container = c
	device.Initialized = true
}

// DeleteDevice deletes the given device from this database. This should be called through Device.Delete()
func (c *Container) DeleteDevice(ctx context.Context, device *store.Device) error {
	if device.ID == nil {
		return ErrDeviceIDMustBeSet
	}
	if device.SessionID == "" {
		return ErrSessionIDRequired
	} else if _, err := uuid.Parse(device.SessionID); err != nil {
		return ErrInvalidSessionID
	} else if device.RevisionID <= 0 {
		return ErrRevisionIDRequired
	}
	return c.doSessionMutation(ctx, SessionScope{SessionID: device.SessionID, RevisionID: device.RevisionID}, func(txCtx context.Context) error {
		// Lock exactly one session revision. Child rows cascade from this same
		// composite ownership key, so equal JIDs in other sessions are untouched.
		var exists int
		lockQuery := lockDeviceScopeQuery
		if c.db.Dialect != dbutil.SQLite {
			lockQuery += " FOR UPDATE"
		}
		err := c.db.QueryRow(txCtx, lockQuery, device.SessionID, device.RevisionID).Scan(&exists)
		if errors.Is(err, sql.ErrNoRows) {
			_, err = c.db.Exec(txCtx, deleteTransportRoutingInfoQuery,
				device.SessionID, device.RevisionID,
				store.WhatsAppTransportNamespace,
				store.WhatsAppTransportRoutingInfoKey,
			)
			return err
		} else if err != nil {
			return err
		}
		if _, err = c.db.Exec(txCtx, deleteTransportRoutingInfoQuery,
			device.SessionID, device.RevisionID,
			store.WhatsAppTransportNamespace,
			store.WhatsAppTransportRoutingInfoKey,
		); err != nil {
			return err
		}
		result, err := c.db.Exec(txCtx, deleteDeviceQuery, device.SessionID, device.RevisionID)
		if err != nil {
			return err
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if affected != 1 {
			return errors.New("device revision was concurrently removed")
		}
		if c.operationGuard == nil && c.mutationGuard == nil {
			if _, err = c.db.Exec(txCtx, `
				DELETE FROM whatsapp_companion_reservation
				WHERE session_id=$1
				  AND NOT EXISTS (
					SELECT 1 FROM whatsapp_device
					WHERE session_id=$1
					  AND fingerprint_version=$2
				  )
			`, device.SessionID, DeviceFingerprintVersion); err != nil {
				return fmt.Errorf("failed to release companion identity reservation: %w", err)
			}
		}
		c.logSessionDebug("info", "device_deleted", SessionScope{SessionID: device.SessionID, RevisionID: device.RevisionID}, nil)
		return nil
	})
}
