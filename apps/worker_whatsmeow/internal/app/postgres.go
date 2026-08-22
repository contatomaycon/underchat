package app

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/url"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
	"github.com/redis/go-redis/v9"
	"go.mau.fi/whatsmeow/store/sqlstore"
)

const (
	workerDatabaseMaxConnections  = 2
	workerDatabasePingTimeout     = 5 * time.Second
	whatsappSessionLeaseTTL       = 30 * time.Second
	whatsappSessionLeaseRenewal   = 5 * time.Second
	whatsappSessionLeaseSafety    = 5 * time.Second
	whatsappCanonicalCodecVersion = 1
	whatsappCanonicalFormat       = "whatsapp-canonical-v1"
)

var dynamicCallTemplatePattern = regexp.MustCompile(`(?i)\{\{\s*(protocol|protocolo|user|sector)\s*\}\}`)
var workerRuntimeContainerIDPattern = regexp.MustCompile(`(?i)^[0-9a-f]{12,64}$`)

var ErrWhatsAppSessionLeaseUnavailable = errors.New("whatsapp session lease is unavailable")
var ErrWhatsAppSessionLeaseLost = errors.New("whatsapp session lease was lost")

const (
	typingSimulationConfigTypeID = "01a12c40-5a6b-7c8d-9e0f-112233445566"
	rejectCallConfigTypeID       = "019b89ac-697e-75cb-83a0-13761ab6d869"
	showCallMessageConfigTypeID  = "019b89ac-697d-750c-b404-241ec3feab8d"
	activeWorkerConfigStatusID   = "019b89ac-4cd6-7583-a7f0-9dc4631b7edc"
	inactiveWorkerConfigStatusID = "019b89ac-4cd7-75af-a657-6e2eaae68143"
)

type whatsappSessionLeaseState struct {
	sessionID     string
	provider      string
	ownerID       string
	fencingToken  int64
	generation    int
	epoch         string
	capability    string
	expiresAt     time.Time
	localDeadline time.Time
	renewed       int
	lastSummary   time.Time
}

type workerConnectionStatusLeaseProof struct {
	OwnerID      string
	FencingToken int64
}

// applySuccessfulSessionLeaseRenewalLocked accepts a PostgreSQL renewal only
// while the corresponding local lease is still authoritative. It must be
// called with leaseMu held. In particular, a successful response that arrives
// after the local safety deadline was crossed cannot revive a provider that
// has already been fenced and closed.
func (p *WorkerPostgres) applySuccessfulSessionLeaseRenewalLocked(
	installed *whatsappSessionLeaseState,
	renewStarted time.Time,
	expiresAt time.Time,
	remainingMS int64,
) (applied bool, recoveryRequired bool, summarize bool, count int) {
	if p.lease != installed || p.leaseErr != nil {
		return false, errors.Is(p.leaseErr, ErrWhatsAppSessionLeaseLost), false, 0
	}
	installed.expiresAt = expiresAt
	installed.localDeadline = renewStarted.Add(time.Duration(remainingMS) * time.Millisecond)
	installed.renewed++
	summarize = time.Since(installed.lastSummary) >= time.Minute
	count = installed.renewed
	if summarize {
		installed.renewed = 0
		installed.lastSummary = time.Now()
	}
	return true, false, summarize, count
}

// WorkerPostgres owns the process-wide transaction-compatible query pool and
// the PostgreSQL row lease that fences one writer per channel. The lease does
// not pin a backend connection and is safe with PgBouncer transaction mode.
type WorkerPostgres struct {
	DB *sql.DB

	operationScopeMu  sync.RWMutex
	operationScope    *workerOperationScope
	leaseOperationMu  sync.Mutex
	leaseMu           sync.Mutex
	lease             *whatsappSessionLeaseState
	leaseOwnerID      string
	leaseCancel       context.CancelFunc
	leaseDone         chan struct{}
	leaseErr          error
	leaseLostHandler  func()
	leaseLostNotified bool
	closed            bool
}

func (p *WorkerPostgres) SetSessionLeaseLostHandler(handler func()) {
	if p == nil {
		return
	}
	p.leaseMu.Lock()
	p.leaseLostHandler = handler
	shouldNotify := handler != nil && errors.Is(p.leaseErr, ErrWhatsAppSessionLeaseLost) && !p.leaseLostNotified
	if shouldNotify {
		p.leaseLostNotified = true
	}
	p.leaseMu.Unlock()
	if shouldNotify {
		go handler()
	}
}

// markSessionLeaseLostLocked is called at the first exact local point where a
// lease can no longer authorize work. It deliberately does not invoke the
// callback while leaseMu is held: the callback closes the provider and clears
// runtime scopes that may re-enter WorkerPostgres.
func (p *WorkerPostgres) markSessionLeaseLostLocked() (func(), bool) {
	p.leaseErr = ErrWhatsAppSessionLeaseLost
	if p.leaseLostHandler == nil || p.leaseLostNotified {
		return nil, false
	}
	p.leaseLostNotified = true
	return p.leaseLostHandler, true
}

type workerOperationScope struct {
	accountID   string
	capability  string
	container   string
	generation  int
	provider    string
	workerID    string
	writerEpoch string
}

type workerDatabaseIdentity struct {
	Capability  string
	Container   string
	Generation  int
	WriterEpoch string
}

func workerRuntimeDatabaseIdentity(cfg Config) (workerDatabaseIdentity, error) {
	hostname, _ := os.Hostname()
	identity := workerDatabaseIdentity{
		Capability:  strings.TrimSpace(cfg.RuntimeCapability),
		Container:   strings.TrimSpace(hostname),
		Generation:  cfg.RuntimeGeneration,
		WriterEpoch: strings.TrimSpace(cfg.WriterEpoch),
	}
	if identity.Generation <= 0 || len(identity.Capability) < 32 || len(identity.Capability) > 512 || !workerRuntimeContainerIDPattern.MatchString(identity.Container) {
		return workerDatabaseIdentity{}, errors.New("worker runtime database identity is incomplete")
	}
	if _, err := uuid.Parse(identity.WriterEpoch); err != nil {
		return workerDatabaseIdentity{}, errors.New("worker writer epoch is invalid")
	}
	return identity, nil
}

func OpenWorkerPostgres(ctx context.Context, cfg Config) (*WorkerPostgres, error) {
	if cfg.WorkerDatabaseURL == "" {
		return nil, errors.New("worker database URL is required for runtime fence and status outbox")
	}

	db, err := sql.Open("postgres", workerPostgresAtomicParametersDSN(cfg.WorkerDatabaseURL))
	if err != nil {
		return nil, fmt.Errorf("open worker database: %w", err)
	}
	db.SetMaxOpenConns(workerDatabaseMaxConnections)
	// Direct runtime and SQLStore queries share transaction-pooled connections.
	// Lease operations are short transactions and never reserve a connection.
	db.SetMaxIdleConns(1)
	db.SetConnMaxIdleTime(30 * time.Second)
	db.SetConnMaxLifetime(30 * time.Minute)

	pingCtx, cancel := context.WithTimeout(ctx, workerDatabasePingTimeout)
	defer cancel()
	if err := db.PingContext(pingCtx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("connect worker database: %w", err)
	}

	return &WorkerPostgres{DB: db, leaseOwnerID: uuid.NewString()}, nil
}

// workerPostgresAtomicParametersDSN forces lib/pq to send Parse, Bind and
// Execute in one protocol batch. Without binary_parameters, lib/pq prepares
// the unnamed statement and binds it in separate round trips. PgBouncer in
// transaction mode may assign a different backend between those round trips,
// producing SQLSTATE 26000/08P01 or binding values against another unnamed
// statement. PostgreSQL still infers ordinary parameter types. Callers must
// keep bytea values as []byte and convert JSON documents to string before a
// ::json/::jsonb cast: in binary mode lib/pq sends []byte as PostgreSQL binary
// data, while the binary jsonb representation requires a version prefix.
func workerPostgresAtomicParametersDSN(raw string) string {
	dsn := strings.TrimSpace(raw)
	parsed, err := url.Parse(dsn)
	if err == nil && (parsed.Scheme == "postgres" || parsed.Scheme == "postgresql") {
		query := parsed.Query()
		query.Set("binary_parameters", "yes")
		parsed.RawQuery = query.Encode()
		return parsed.String()
	}
	// lib/pq keyword DSNs use last-value-wins parsing, so the final option also
	// safely overrides an accidental binary_parameters=no supplied upstream.
	return strings.TrimSpace(dsn + " binary_parameters=yes")
}

// workerPostgresJSONText marks a marshaled JSON document as a text protocol
// parameter. This boundary is required while binary_parameters=yes is enabled:
// a raw []byte would otherwise be interpreted as jsonb's binary wire format,
// whose first byte is a version number rather than the document's opening '{'.
// Keeping this conversion next to the database boundary also leaves real bytea
// parameters untouched.
func workerPostgresJSONText(payload []byte) string {
	return string(payload)
}

// HydrateWarmRuntime converts an immutable warm-container identity into its
// durable channel assignment after a Docker/process restart. The capability
// itself never leaves the process; PostgreSQL compares only its digest.
func (p *WorkerPostgres) HydrateWarmRuntime(ctx context.Context, cfg Config) (Config, bool, error) {
	if p == nil || p.DB == nil || !cfg.WarmStandby {
		return cfg, false, nil
	}
	warmPoolID := strings.TrimSpace(cfg.WarmPoolID)
	capability := strings.TrimSpace(cfg.RuntimeCapability)
	hostname, _ := os.Hostname()
	if warmPoolID == "" || len(capability) < 32 || strings.TrimSpace(hostname) == "" {
		return cfg, false, nil
	}

	var workerID, accountID, workerTypeID, writerEpoch, sessionStorage string
	var generation int
	err := p.DB.QueryRowContext(ctx, `
		SELECT worker_id, account_id, worker_type_id, runtime_generation,
			writer_epoch, session_storage
		FROM hydrate_whatsapp_warm_runtime($1::uuid, $2, $3)
	`, warmPoolID, capability, hostname).Scan(
		&workerID,
		&accountID,
		&workerTypeID,
		&generation,
		&writerEpoch,
		&sessionStorage,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return cfg, false, nil
	}
	if err != nil {
		return cfg, false, fmt.Errorf("hydrate warm runtime: %w", err)
	}
	if workerTypeID != WorkerTypeWhatsmeow || sessionStorage != SessionStoragePostgres || generation <= 0 {
		return cfg, false, errors.New("hydrated warm runtime identity is invalid")
	}
	if _, err := uuid.Parse(workerID); err != nil {
		return cfg, false, errors.New("hydrated warm worker ID is invalid")
	}
	if _, err := uuid.Parse(accountID); err != nil {
		return cfg, false, errors.New("hydrated warm account ID is invalid")
	}
	if _, err := uuid.Parse(writerEpoch); err != nil {
		return cfg, false, errors.New("hydrated warm writer epoch is invalid")
	}

	cfg.WorkerID = workerID
	cfg.AccountID = accountID
	cfg.RuntimeGeneration = generation
	cfg.WriterEpoch = writerEpoch
	cfg.SessionStorage = sessionStorage
	cfg.WarmStandby = false
	return cfg, true, nil
}

func (p *WorkerPostgres) AcquireSessionLease(ctx context.Context, cfg Config) error {
	return p.acquireSessionLease(ctx, cfg, false)
}

func (p *WorkerPostgres) ReacquireSessionLease(ctx context.Context, cfg Config) error {
	return p.acquireSessionLease(ctx, cfg, true)
}

func (p *WorkerPostgres) acquireSessionLease(ctx context.Context, cfg Config, force bool) error {
	if p == nil || p.DB == nil {
		return errors.New("worker database is unavailable")
	}
	if _, err := uuid.Parse(cfg.WorkerID); err != nil {
		return errors.New("session ID must be a UUID")
	}
	if cfg.RuntimeGeneration <= 0 {
		return errors.New("runtime generation must be positive")
	}
	if _, err := uuid.Parse(cfg.WriterEpoch); err != nil {
		return errors.New("writer epoch must be a UUID")
	}

	p.leaseOperationMu.Lock()
	defer p.leaseOperationMu.Unlock()
	p.leaseMu.Lock()
	if p.closed {
		p.leaseMu.Unlock()
		return errors.New("worker postgres is closed")
	}
	if !force && p.lease != nil && p.leaseErr == nil &&
		p.lease.sessionID == cfg.WorkerID &&
		p.lease.generation == cfg.RuntimeGeneration &&
		p.lease.epoch == cfg.WriterEpoch &&
		time.Now().Before(p.lease.localDeadline.Add(-whatsappSessionLeaseSafety)) {
		p.leaseMu.Unlock()
		return nil
	}
	oldCancel := p.leaseCancel
	oldDone := p.leaseDone
	p.leaseCancel = nil
	p.leaseDone = nil
	p.leaseMu.Unlock()
	if oldCancel != nil {
		oldCancel()
	}
	if oldDone != nil {
		select {
		case <-oldDone:
		case <-ctx.Done():
			return ctx.Err()
		}
	}

	var token int64
	var expiresAt time.Time
	var remainingMS int64
	acquireStarted := time.Now()
	err := p.DB.QueryRowContext(ctx, `
		SELECT fencing_token, expires_at, remaining_ms
		FROM acquire_whatsapp_session_lease(
			$1::uuid, $2::uuid, 'whatsmeow', $3, $4::uuid, $5, $6
		)
	`, cfg.WorkerID, p.leaseOwnerID, cfg.RuntimeGeneration, cfg.WriterEpoch,
		whatsappSessionLeaseTTL.Milliseconds(), cfg.RuntimeCapability,
	).Scan(&token, &expiresAt, &remainingMS)
	if err != nil {
		logWhatsappSessionDebug(cfg.WhatsappSessionDebugEnabled, "lease_acquire_failed", map[string]any{
			"session_id": cfg.WorkerID,
			"provider":   "whatsmeow",
			"generation": cfg.RuntimeGeneration,
			"error":      safeOperationalErrorCode(err),
		})
		return errors.Join(ErrWhatsAppSessionLeaseUnavailable, err)
	}
	if token <= 0 || remainingMS <= whatsappSessionLeaseSafety.Milliseconds() {
		return ErrWhatsAppSessionLeaseUnavailable
	}

	leaseCtx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	state := &whatsappSessionLeaseState{
		sessionID: cfg.WorkerID, provider: "whatsmeow", ownerID: p.leaseOwnerID,
		fencingToken: token, generation: cfg.RuntimeGeneration,
		epoch: cfg.WriterEpoch, capability: cfg.RuntimeCapability,
		expiresAt:     expiresAt,
		localDeadline: acquireStarted.Add(time.Duration(remainingMS) * time.Millisecond),
		lastSummary:   time.Now(),
	}
	p.leaseMu.Lock()
	if p.closed {
		p.leaseMu.Unlock()
		cancel()
		return errors.New("worker postgres is closed")
	}
	p.lease = state
	p.leaseErr = nil
	p.leaseLostNotified = false
	p.leaseCancel = cancel
	p.leaseDone = done
	p.leaseMu.Unlock()
	go p.renewSessionLease(leaseCtx, done, cfg.WhatsappSessionDebugEnabled, state)
	logWhatsappSessionDebug(cfg.WhatsappSessionDebugEnabled, "lease_acquired", map[string]any{
		"session_id":    cfg.WorkerID,
		"provider":      "whatsmeow",
		"generation":    cfg.RuntimeGeneration,
		"fencing_token": token,
		"remaining_ms":  remainingMS,
	})
	return nil
}

func (p *WorkerPostgres) renewSessionLease(ctx context.Context, done chan struct{}, debug bool, installed *whatsappSessionLeaseState) {
	defer close(done)
	ticker := time.NewTicker(whatsappSessionLeaseRenewal)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}

		renewCtx, cancel := context.WithTimeout(ctx, workerDatabasePingTimeout)
		var token int64
		var expiresAt time.Time
		var remainingMS int64
		renewStarted := time.Now()
		err := p.DB.QueryRowContext(renewCtx, `
			SELECT fencing_token, expires_at, remaining_ms
			FROM renew_whatsapp_session_lease(
				$1::uuid, $2::uuid, $3, $4, $5, $6::uuid, $7, $8
			)
		`, installed.sessionID, installed.ownerID, installed.provider,
			installed.fencingToken, installed.generation, installed.epoch,
			whatsappSessionLeaseTTL.Milliseconds(), installed.capability,
		).Scan(&token, &expiresAt, &remainingMS)
		cancel()

		p.leaseMu.Lock()
		if p.lease != installed {
			p.leaseMu.Unlock()
			return
		}
		if err == nil && token == installed.fencingToken && remainingMS > whatsappSessionLeaseSafety.Milliseconds() {
			// A caller may have crossed the local safety deadline while this SQL
			// request was in flight. Once that happens the provider is closed and
			// lease_lost is intentionally sticky: only the availability guard may
			// reacquire a fresh fencing token and resume the persisted session. A
			// late successful renewal must never erase the error without executing
			// that recovery pipeline.
			applied, recoveryRequired, shouldSummarize, count :=
				p.applySuccessfulSessionLeaseRenewalLocked(installed, renewStarted, expiresAt, remainingMS)
			if !applied {
				p.leaseMu.Unlock()
				if recoveryRequired {
					logWhatsappSessionDebug(debug, "lease_renew_recovery_required", map[string]any{
						"session_id":    installed.sessionID,
						"provider":      installed.provider,
						"generation":    installed.generation,
						"fencing_token": installed.fencingToken,
						"reason":        "local_lease_already_lost",
					})
				}
				return
			}
			p.leaseMu.Unlock()
			if shouldSummarize {
				logWhatsappSessionDebug(debug, "lease_renew_summary", map[string]any{
					"session_id":    installed.sessionID,
					"provider":      installed.provider,
					"generation":    installed.generation,
					"fencing_token": installed.fencingToken,
					"renewals":      count,
					"remaining_ms":  remainingMS,
				})
			}
			continue
		}

		definitive := false
		var pqErr *pq.Error
		if errors.As(err, &pqErr) && pqErr.Code == "55000" {
			definitive = true
		}
		if token != 0 && token != installed.fencingToken {
			definitive = true
		}
		if definitive || time.Now().After(installed.localDeadline.Add(-whatsappSessionLeaseSafety)) {
			handler, shouldNotify := p.markSessionLeaseLostLocked()
			p.leaseMu.Unlock()
			logWhatsappSessionDebug(debug, "lease_lost", map[string]any{
				"session_id":    installed.sessionID,
				"provider":      installed.provider,
				"generation":    installed.generation,
				"fencing_token": installed.fencingToken,
				"error":         safeOperationalErrorCode(err),
			})
			if shouldNotify && handler != nil {
				go handler()
			}
			return
		}
		p.leaseMu.Unlock()
		logWhatsappSessionDebug(debug, "lease_renew_failed", map[string]any{
			"session_id":    installed.sessionID,
			"provider":      installed.provider,
			"generation":    installed.generation,
			"fencing_token": installed.fencingToken,
			"error":         safeOperationalErrorCode(err),
		})
	}
}

func (p *WorkerPostgres) SessionLeaseToken() (int64, bool) {
	if p == nil {
		return 0, false
	}
	p.leaseMu.Lock()
	if p.lease == nil || p.leaseErr != nil {
		p.leaseMu.Unlock()
		return 0, false
	}
	if time.Now().After(p.lease.localDeadline.Add(-whatsappSessionLeaseSafety)) {
		handler, shouldNotify := p.markSessionLeaseLostLocked()
		p.leaseMu.Unlock()
		if shouldNotify {
			go handler()
		}
		return 0, false
	}
	token := p.lease.fencingToken
	p.leaseMu.Unlock()
	return token, true
}

func (p *WorkerPostgres) ConnectionStatusLeaseProof() (workerConnectionStatusLeaseProof, bool) {
	if p == nil {
		return workerConnectionStatusLeaseProof{}, false
	}
	p.leaseMu.Lock()
	if p.lease == nil || p.leaseErr != nil || p.lease.ownerID == "" || p.lease.fencingToken <= 0 {
		p.leaseMu.Unlock()
		return workerConnectionStatusLeaseProof{}, false
	}
	if time.Now().After(p.lease.localDeadline.Add(-whatsappSessionLeaseSafety)) {
		handler, shouldNotify := p.markSessionLeaseLostLocked()
		p.leaseMu.Unlock()
		if shouldNotify {
			go handler()
		}
		return workerConnectionStatusLeaseProof{}, false
	}
	if _, err := uuid.Parse(p.lease.ownerID); err != nil {
		p.leaseMu.Unlock()
		return workerConnectionStatusLeaseProof{}, false
	}
	proof := workerConnectionStatusLeaseProof{
		OwnerID:      p.lease.ownerID,
		FencingToken: p.lease.fencingToken,
	}
	p.leaseMu.Unlock()
	return proof, true
}

func (p *WorkerPostgres) SessionOperationFence() (string, int64, int, string, string, error) {
	if p == nil {
		return "", 0, 0, "", "", ErrWhatsAppSessionLeaseLost
	}
	p.leaseMu.Lock()
	if p.lease == nil || p.leaseErr != nil {
		p.leaseMu.Unlock()
		return "", 0, 0, "", "", ErrWhatsAppSessionLeaseLost
	}
	if time.Now().After(p.lease.localDeadline.Add(-whatsappSessionLeaseSafety)) {
		handler, shouldNotify := p.markSessionLeaseLostLocked()
		p.leaseMu.Unlock()
		if shouldNotify {
			go handler()
		}
		return "", 0, 0, "", "", ErrWhatsAppSessionLeaseLost
	}
	ownerID := p.lease.ownerID
	token := p.lease.fencingToken
	generation := p.lease.generation
	epoch := p.lease.epoch
	capability := p.lease.capability
	p.leaseMu.Unlock()
	return ownerID, token, generation, epoch, capability, nil
}

type whatsappSessionRevisionOpen struct {
	RevisionID int64
	Status     string
	HandoffID  sql.NullString
}

func (p *WorkerPostgres) openSessionRevision(ctx context.Context, cfg Config) (whatsappSessionRevisionOpen, error) {
	ownerID, token, generation, epoch, capability, err := p.SessionOperationFence()
	if err != nil {
		return whatsappSessionRevisionOpen{}, err
	}
	var opened whatsappSessionRevisionOpen
	source := "pairing"
	if cfg.SessionStorageMigrationID != "" {
		source = "legacy_volume_migration"
		tx, txErr := p.DB.BeginTx(ctx, nil)
		if txErr != nil {
			return whatsappSessionRevisionOpen{}, txErr
		}
		defer tx.Rollback()
		if _, txErr = tx.ExecContext(ctx, `SELECT set_config('app.whatsapp_storage_migration_id', $1, true)`, cfg.SessionStorageMigrationID); txErr != nil {
			return whatsappSessionRevisionOpen{}, fmt.Errorf("scope whatsapp storage migration: %w", txErr)
		}
		err = tx.QueryRowContext(ctx, `
			SELECT revision_id, status, handoff_id::text
			FROM open_whatsapp_session_revision(
				$1::uuid, $2::uuid, 'whatsmeow', $3, $4, $5::uuid, $6,
				$7, $8, $9, $10
			)
		`, cfg.WorkerID, ownerID, token, generation, epoch, capability,
			source, sqlstore.SharedSchemaVersion, whatsappCanonicalCodecVersion,
			whatsappCanonicalFormat).Scan(
			&opened.RevisionID, &opened.Status, &opened.HandoffID,
		)
		if err == nil {
			err = tx.Commit()
		}
	} else {
		err = p.DB.QueryRowContext(ctx, `
		SELECT revision_id, status, handoff_id::text
		FROM open_whatsapp_session_revision(
			$1::uuid, $2::uuid, 'whatsmeow', $3, $4, $5::uuid, $6,
			$7, $8, $9, $10
		)
	`, cfg.WorkerID, ownerID, token, generation, epoch, capability,
			source, sqlstore.SharedSchemaVersion, whatsappCanonicalCodecVersion,
			whatsappCanonicalFormat).Scan(
			&opened.RevisionID, &opened.Status, &opened.HandoffID,
		)
	}
	if err != nil {
		return whatsappSessionRevisionOpen{}, fmt.Errorf("open whatsapp session revision: %w", err)
	}
	if opened.RevisionID <= 0 || (opened.Status != "staging" && opened.Status != "validating" && opened.Status != "active") {
		return whatsappSessionRevisionOpen{}, errors.New("whatsapp session revision is not writable")
	}
	if opened.HandoffID.Valid {
		if _, err := uuid.Parse(opened.HandoffID.String); err != nil || opened.Status == "active" {
			return whatsappSessionRevisionOpen{}, errors.New("whatsapp session handoff revision is invalid")
		}
	}
	logWhatsappSessionDebug(cfg.WhatsappSessionDebugEnabled, "revision_opened", map[string]any{
		"session_id":    cfg.WorkerID,
		"provider":      "whatsmeow",
		"revision":      opened.RevisionID,
		"generation":    generation,
		"fencing_token": token,
		"stage":         opened.Status,
		"handoff":       opened.HandoffID.Valid,
	})
	return opened, nil
}

// OpenSessionRevision preserves the existing worker API for normal revision
// users. Startup uses openSessionRevision directly to detect a target handoff.
func (p *WorkerPostgres) OpenSessionRevision(ctx context.Context, cfg Config) (int64, string, error) {
	opened, err := p.openSessionRevision(ctx, cfg)
	if err != nil {
		return 0, "", err
	}
	return opened.RevisionID, opened.Status, nil
}

func (p *WorkerPostgres) Ping(ctx context.Context) error {
	if p == nil || p.DB == nil {
		return errors.New("worker database is unavailable")
	}
	p.leaseMu.Lock()
	lease := p.lease
	leaseErr := p.leaseErr
	if lease != nil && time.Now().After(lease.localDeadline.Add(-whatsappSessionLeaseSafety)) {
		leaseErr = ErrWhatsAppSessionLeaseLost
		handler, shouldNotify := p.markSessionLeaseLostLocked()
		p.leaseMu.Unlock()
		if shouldNotify && handler != nil {
			go handler()
		}
		return leaseErr
	}
	p.leaseMu.Unlock()
	if leaseErr != nil {
		return leaseErr
	}
	return p.DB.PingContext(ctx)
}

// PingDatabase checks only PostgreSQL reachability. The availability guard
// uses it after fail-closed suspension because a lost session lease remains
// sticky until ReacquireSessionLease succeeds.
func (p *WorkerPostgres) PingDatabase(ctx context.Context) error {
	if p == nil || p.DB == nil {
		return errors.New("worker database is unavailable")
	}
	return p.DB.PingContext(ctx)
}

func (p *WorkerPostgres) ReleaseSessionLease(ctx context.Context) error {
	return p.releaseSessionLease(ctx, false)
}

func (p *WorkerPostgres) ReleaseSessionLeaseForHandoff(ctx context.Context) error {
	return p.releaseSessionLease(ctx, true)
}

func (p *WorkerPostgres) releaseSessionLease(ctx context.Context, requireReleased bool) error {
	if p == nil {
		return nil
	}
	p.leaseOperationMu.Lock()
	defer p.leaseOperationMu.Unlock()
	p.leaseMu.Lock()
	state := p.lease
	cancel := p.leaseCancel
	done := p.leaseDone
	// Stop renewal before attempting the release, but retain the complete
	// fencing identity until PostgreSQL confirms it. A transport error can
	// happen after the release transaction committed; keeping this state lets
	// the caller retry the same idempotent, fully-scoped release instead of
	// losing the token and becoming permanently unable to prove the drain.
	if state != nil {
		p.leaseErr = ErrWhatsAppSessionLeaseLost
	}
	p.leaseMu.Unlock()
	if cancel != nil {
		cancel()
	}
	if done != nil {
		select {
		case <-done:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	if state == nil || p.DB == nil {
		if requireReleased {
			return errors.New("whatsapp handoff session lease is not held")
		}
		return nil
	}
	var released bool
	err := p.DB.QueryRowContext(ctx, `
		SELECT release_whatsapp_session_lease(
			$1::uuid, $2::uuid, $3, $4, $5, $6::uuid, $7
		)
	`, state.sessionID, state.ownerID, state.provider, state.fencingToken,
		state.generation, state.epoch, state.capability).Scan(&released)
	if err != nil {
		return fmt.Errorf("release whatsapp session lease: %w", err)
	}
	logWhatsappSessionDebug(true, "lease_released", map[string]any{
		"session_id":    state.sessionID,
		"provider":      state.provider,
		"generation":    state.generation,
		"fencing_token": state.fencingToken,
		"released":      released,
	})
	if requireReleased && !released {
		return errors.New("whatsapp handoff session lease release was fenced")
	}
	if released {
		p.leaseMu.Lock()
		if p.lease == state {
			p.lease = nil
			p.leaseCancel = nil
			p.leaseDone = nil
			p.leaseErr = nil
		}
		p.leaseMu.Unlock()
	}
	return nil
}

func (p *WorkerPostgres) Close(ctx context.Context) error {
	if p == nil {
		return nil
	}
	p.leaseMu.Lock()
	if p.closed {
		p.leaseMu.Unlock()
		return nil
	}
	p.closed = true
	p.leaseMu.Unlock()
	leaseErr := p.ReleaseSessionLease(ctx)
	var dbErr error
	if p.DB != nil {
		dbErr = p.DB.Close()
	}
	return errors.Join(leaseErr, dbErr)
}

// ResolveOwnedRuntimeConnectionFence returns the pending or consumed epoch
// durably owned by a pairing grant for this exact runtime identity. Zero rows
// means the generation is legacy/unowned and may retain the random-epoch path.
func (p *WorkerPostgres) ResolveOwnedRuntimeConnectionFence(
	ctx context.Context,
	cfg Config,
	provider string,
) (*WhatsappRuntimeOwnedConnectionFence, error) {
	identity, err := workerRuntimeDatabaseIdentity(cfg)
	if err != nil {
		return nil, err
	}
	return p.resolveOwnedRuntimeConnectionFence(ctx, cfg, provider, identity)
}

func (p *WorkerPostgres) resolveOwnedRuntimeConnectionFence(
	ctx context.Context,
	cfg Config,
	provider string,
	identity workerDatabaseIdentity,
) (*WhatsappRuntimeOwnedConnectionFence, error) {
	provider = strings.ToLower(strings.TrimSpace(provider))
	if provider == "" {
		return nil, errors.New("runtime fence provider is required")
	}

	var result WhatsappRuntimeOwnedConnectionFence
	err := p.DB.QueryRowContext(ctx, `
		SELECT connection_epoch::text,
		       connection_attempt_id::text,
		       connection_sequence,
		       authorization_state
		FROM resolve_whatsapp_runtime_owned_connection_fence(
			$1::uuid, $2::uuid, $3, $4, $5::uuid, $6, $7
		)
	`, cfg.WorkerID, cfg.AccountID, provider,
		identity.Generation, identity.WriterEpoch, identity.Capability,
		identity.Container,
	).Scan(
		&result.ConnectionEpoch,
		&result.ConnectionAttemptID,
		&result.ConnectionSequence,
		&result.AuthorizationState,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("resolve owned runtime connection fence: %w", err)
	}
	if err := validateResolvedRuntimeConnectionFence(&result); err != nil {
		return nil, err
	}
	return &result, nil
}

func validateResolvedRuntimeConnectionFence(
	result *WhatsappRuntimeOwnedConnectionFence,
) error {
	if result == nil {
		return errors.New("resolved runtime connection fence is missing")
	}
	if _, err := uuid.Parse(result.ConnectionEpoch); err != nil {
		return errors.New("resolved runtime connection epoch is invalid")
	}
	if _, err := uuid.Parse(result.ConnectionAttemptID); err != nil {
		return errors.New("resolved runtime connection attempt is invalid")
	}
	result.AuthorizationState = strings.ToLower(strings.TrimSpace(result.AuthorizationState))
	switch result.AuthorizationState {
	case "pending":
		if result.ConnectionSequence < 0 {
			return errors.New("resolved pending runtime connection sequence is invalid")
		}
	case "owned":
		if result.ConnectionSequence <= 0 {
			return errors.New("resolved owned runtime connection sequence is invalid")
		}
	default:
		return errors.New("resolved runtime connection authorization state is invalid")
	}
	return nil
}

func (p *WorkerPostgres) ActivateRuntimeFence(
	ctx context.Context,
	cfg Config,
	payload WhatsappRuntimeFenceActivationRequest,
) (WhatsappRuntimeFenceActivationResponse, error) {
	identity, err := workerRuntimeDatabaseIdentity(cfg)
	if err != nil {
		return WhatsappRuntimeFenceActivationResponse{}, err
	}
	return p.activateRuntimeFence(ctx, cfg, payload, identity)
}

func (p *WorkerPostgres) activateRuntimeFence(
	ctx context.Context,
	cfg Config,
	payload WhatsappRuntimeFenceActivationRequest,
	identity workerDatabaseIdentity,
) (WhatsappRuntimeFenceActivationResponse, error) {
	var result WhatsappRuntimeFenceActivationResponse
	var connectionAttemptID any
	if value := strings.TrimSpace(payload.ConnectionAttemptID); value != "" {
		if _, err := uuid.Parse(value); err != nil {
			return WhatsappRuntimeFenceActivationResponse{}, errors.New("runtime fence connection attempt is invalid")
		}
		connectionAttemptID = value
	}
	err := p.DB.QueryRowContext(ctx, `
		SELECT activated, already_active, connection_sequence
		FROM activate_whatsapp_runtime_fence($1::uuid, $2::uuid, $3, $4,
			$5::uuid, $6, $7, $8::uuid, $9::uuid)
	`, payload.WorkerID, payload.AccountID, payload.SourceProvider,
		identity.Generation, identity.WriterEpoch, identity.Capability,
		identity.Container,
		payload.ConnectionEpoch,
		connectionAttemptID,
	).Scan(&result.Activated, &result.AlreadyActive, &result.ConnectionSequence)
	if err != nil {
		return WhatsappRuntimeFenceActivationResponse{}, fmt.Errorf("activate runtime fence: %w", err)
	}
	if !result.Activated || result.ConnectionSequence <= 0 {
		return WhatsappRuntimeFenceActivationResponse{}, errWhatsAppRuntimeFenceActivationRejected
	}
	p.operationScopeMu.Lock()
	p.operationScope = &workerOperationScope{
		accountID: cfg.AccountID, capability: identity.Capability,
		container: identity.Container, generation: identity.Generation,
		provider: "whatsmeow", workerID: cfg.WorkerID,
		writerEpoch: identity.WriterEpoch,
	}
	p.operationScopeMu.Unlock()
	return result, nil
}

func (p *WorkerPostgres) beginWorkerOperation(
	ctx context.Context,
	tx *sql.Tx,
	workerID string,
	accountID string,
) error {
	if p == nil || tx == nil {
		return errors.New("worker runtime database is unavailable")
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
		return errors.New("worker runtime database scope rejected")
	}
	var scoped bool
	err := tx.QueryRowContext(ctx, `
		SELECT begin_whatsapp_worker_operation(
			$1::uuid, $2::uuid, $3, $4, $5::uuid, $6, $7
		)
	`, scope.workerID, scope.accountID, scope.provider, scope.generation,
		scope.writerEpoch, scope.capability, scope.container).Scan(&scoped)
	if err != nil {
		return fmt.Errorf("begin worker database operation: %w", err)
	}
	if !scoped {
		return errors.New("worker runtime database scope rejected")
	}
	return nil
}

func (p *WorkerPostgres) ApplyWorkerStatus(ctx context.Context, cfg Config, state ConnectionState) error {
	return p.applyWorkerStatus(ctx, cfg, state, uuid.NewString(), nil)
}

func (p *WorkerPostgres) ApplyNativeConnectionStatus(
	ctx context.Context,
	cfg Config,
	state ConnectionState,
	eventID string,
	leaseProof *workerConnectionStatusLeaseProof,
) error {
	return p.applyWorkerStatus(ctx, cfg, state, eventID, leaseProof)
}

func (p *WorkerPostgres) applyWorkerStatus(
	ctx context.Context,
	cfg Config,
	state ConnectionState,
	eventID string,
	leaseProof *workerConnectionStatusLeaseProof,
) error {
	identity, err := workerRuntimeDatabaseIdentity(cfg)
	if err != nil {
		return err
	}
	state, err = canonicalWorkerStatusPayload(cfg, state)
	if err != nil {
		return err
	}
	parsedEventID, err := uuid.Parse(strings.TrimSpace(eventID))
	if err != nil {
		return errors.New("worker runtime event ID is invalid")
	}
	privatePayload := struct {
		ConnectionState
		ConnectionStatusLeaseOwnerID string `json:"connection_status_lease_owner_id,omitempty"`
		ConnectionStatusFencingToken string `json:"connection_status_fencing_token,omitempty"`
	}{ConnectionState: state}
	if leaseProof != nil {
		if _, parseErr := uuid.Parse(leaseProof.OwnerID); parseErr != nil || leaseProof.FencingToken <= 0 {
			return errors.New("worker runtime connection status lease proof is invalid")
		}
		privatePayload.ConnectionStatusLeaseOwnerID = leaseProof.OwnerID
		privatePayload.ConnectionStatusFencingToken = fmt.Sprintf("%d", leaseProof.FencingToken)
	}
	payload, err := json.Marshal(privatePayload)
	if err != nil {
		return fmt.Errorf("encode worker status: %w", err)
	}
	nativeSequence := uint64(0)
	if state.ConnectionStatus != nil {
		nativeSequence = state.ConnectionStatus.Sequence
	}
	var outcome string
	startedAt := time.Now()
	err = p.DB.QueryRowContext(ctx, `
		SELECT outcome FROM apply_worker_runtime_status(
			$1::uuid, $2::uuid, 'whatsmeow', $3, $4::uuid, $5, $6, $7::jsonb, $8::uuid
		)
	`, cfg.WorkerID, cfg.AccountID, identity.Generation, identity.WriterEpoch,
		identity.Capability, identity.Container, workerPostgresJSONText(payload), parsedEventID.String(),
	).Scan(&outcome)
	if err != nil {
		logWhatsappSessionDebug(cfg.WhatsappSessionDebugEnabled, "status_outbox.admission_failed", map[string]any{
			"trace_id":           state.DebugTraceID,
			"session_id":         cfg.WorkerID,
			"provider":           "whatsmeow",
			"runtime_generation": cfg.RuntimeGeneration,
			"event_type":         state.EventType,
			"status":             state.Status,
			"native_sequence":    nativeSequence,
			"duration_ms":        time.Since(startedAt).Milliseconds(),
			"error_code":         safeOperationalErrorCode(err),
		})
		return fmt.Errorf("apply worker status: %w", err)
	}
	if outcome != "applied" && outcome != "idempotent" && outcome != "duplicate" && outcome != "deferred" {
		logWhatsappSessionDebug(cfg.WhatsappSessionDebugEnabled, "status_outbox.admission_rejected", map[string]any{
			"trace_id":           state.DebugTraceID,
			"session_id":         cfg.WorkerID,
			"provider":           "whatsmeow",
			"runtime_generation": cfg.RuntimeGeneration,
			"event_type":         state.EventType,
			"status":             state.Status,
			"native_sequence":    nativeSequence,
			"duration_ms":        time.Since(startedAt).Milliseconds(),
			"outcome":            outcome,
		})
		return fmt.Errorf("worker status rejected: %s", outcome)
	}
	logWhatsappSessionDebug(cfg.WhatsappSessionDebugEnabled, "status_outbox.admitted", map[string]any{
		"trace_id":           state.DebugTraceID,
		"session_id":         cfg.WorkerID,
		"provider":           "whatsmeow",
		"runtime_generation": cfg.RuntimeGeneration,
		"event_type":         state.EventType,
		"status":             state.Status,
		"native_sequence":    nativeSequence,
		"duration_ms":        time.Since(startedAt).Milliseconds(),
		"outcome":            outcome,
		"strong_online":      state.WorkerStatusID == WorkerStatusOnline,
	})
	return nil
}

func canonicalWorkerStatusPayload(cfg Config, state ConnectionState) (ConnectionState, error) {
	workerID := strings.TrimSpace(cfg.WorkerID)
	accountID := strings.TrimSpace(cfg.AccountID)
	if workerID == "" || accountID == "" {
		return ConnectionState{}, errors.New("worker status identity is incomplete")
	}
	if value := strings.TrimSpace(state.WorkerID); value != "" && value != workerID {
		return ConnectionState{}, errors.New("worker status worker ID does not match the runtime")
	}
	if value := strings.TrimSpace(state.AccountID); value != "" && value != accountID {
		return ConnectionState{}, errors.New("worker status account ID does not match the runtime")
	}
	if value := strings.TrimSpace(state.WorkerTypeID); value != "" && value != WorkerTypeWhatsmeow {
		return ConnectionState{}, errors.New("worker status worker type does not match whatsmeow")
	}
	if value := strings.TrimSpace(state.SourceProvider); value != "" && value != "whatsmeow" {
		return ConnectionState{}, errors.New("worker status provider does not match whatsmeow")
	}
	if state.RuntimeGeneration != 0 && state.RuntimeGeneration != cfg.RuntimeGeneration {
		return ConnectionState{}, errors.New("worker status generation does not match the runtime")
	}

	state.WorkerID = workerID
	state.AccountID = accountID
	state.WorkerTypeID = WorkerTypeWhatsmeow
	state.SourceProvider = "whatsmeow"
	state.RuntimeGeneration = cfg.RuntimeGeneration
	eventType := strings.ToLower(strings.TrimSpace(state.EventType))
	if eventType == "" {
		eventType = "status"
	}
	if eventType != "status" && eventType != "telemetry" {
		return ConnectionState{}, errors.New("worker status event type is invalid")
	}
	state.EventType = eventType
	if eventType == "telemetry" {
		state.WorkerStatusID = ""
		state.RequiresConnectionFence = false
		return state, nil
	}

	isOnline := state.WorkerStatusID == WorkerStatusOnline
	state.RequiresConnectionFence = isOnline
	if !isOnline {
		return state, nil
	}
	if _, err := uuid.Parse(strings.TrimSpace(state.ConnectionEpoch)); err != nil {
		return ConnectionState{}, errors.New("online worker status connection epoch is invalid")
	}
	if state.ConnectionSequence <= 0 {
		return ConnectionState{}, errors.New("online worker status connection sequence is invalid")
	}
	return state, nil
}

func (p *WorkerPostgres) RequestSelfHealing(ctx context.Context, cfg Config, payload SelfHealingRequest) error {
	identity, err := workerRuntimeDatabaseIdentity(cfg)
	if err != nil {
		return err
	}
	evidence, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("encode self-healing evidence: %w", err)
	}
	digest := sha256.Sum256([]byte(fmt.Sprintf("%s\x00%d\x00%s", cfg.WorkerID, identity.Generation, payload.Reason)))
	var requestID string
	err = p.DB.QueryRowContext(ctx, `
		SELECT request_id FROM request_worker_self_heal(
			$1::uuid, $2::uuid, 'whatsmeow', $3, $4::uuid, $5, $6, $7, $8::jsonb, $9
		)
	`, cfg.WorkerID, cfg.AccountID, identity.Generation, identity.WriterEpoch,
		identity.Capability, identity.Container, payload.Reason, workerPostgresJSONText(evidence),
		hex.EncodeToString(digest[:]),
	).Scan(&requestID)
	if err != nil {
		return fmt.Errorf("request worker self-healing: %w", err)
	}
	return nil
}

func (p *WorkerPostgres) GetTypingSimulationConfig(ctx context.Context, cfg Config) (TypingSimulationConfig, error) {
	result := defaultTypingSimulationConfig()
	identity, err := workerRuntimeDatabaseIdentity(cfg)
	if err != nil {
		return result, err
	}
	var value sql.NullString
	var status sql.NullString
	err = p.DB.QueryRowContext(ctx, `
		SELECT value, worker_config_status_id::text
		FROM read_whatsapp_worker_typing_config(
			$1::uuid, $2::uuid, 'whatsmeow', $3, $4::uuid, $5, $6, $7::uuid
		)
	`, cfg.WorkerID, cfg.AccountID, identity.Generation, identity.WriterEpoch,
		identity.Capability, identity.Container, typingSimulationConfigTypeID,
	).Scan(&value, &status)
	if errors.Is(err, sql.ErrNoRows) {
		return result, errors.New("worker runtime database fence rejected")
	}
	if err != nil {
		return result, fmt.Errorf("read typing simulation config: %w", err)
	}
	if !status.Valid {
		return result, nil
	}
	result.Enabled = status.String != inactiveWorkerConfigStatusID
	if value.Valid {
		var speed int
		if _, err := fmt.Sscanf(value.String, "%d", &speed); err == nil {
			result.Speed = speed
		}
	}
	return normalizeTypingSimulationConfig(result), nil
}

func (p *WorkerPostgres) RegisterS3BackupFallbackUpload(ctx context.Context, cfg Config, payload S3BackupFallbackUpload) error {
	identity, err := workerRuntimeDatabaseIdentity(cfg)
	if err != nil {
		return err
	}
	if strings.TrimSpace(payload.AccountID) != strings.TrimSpace(cfg.AccountID) {
		return errors.New("worker runtime database scope rejected")
	}
	var uploadID string
	err = p.DB.QueryRowContext(ctx, `
		SELECT register_whatsapp_worker_s3_backup(
			$1::uuid, $2::uuid, 'whatsmeow', $3, $4::uuid, $5, $6,
			$7, $8, $9, $10, $11, $12, $13, $14, $15
		)::text
	`, cfg.WorkerID, payload.AccountID, identity.Generation,
		identity.WriterEpoch, identity.Capability, identity.Container,
		payload.Bucket, payload.ObjectKey, payload.FileName, payload.ContentType,
		payload.SizeBytes, payload.PrimaryAttempts, payload.BackupAttempts,
		payload.PrimaryError, payload.BackupError).Scan(&uploadID)
	if err != nil {
		return err
	}
	if _, err := uuid.Parse(uploadID); err != nil {
		return errors.New("worker runtime database fence rejected")
	}
	return nil
}

func (p *WorkerPostgres) ResolveIncomingCallAction(
	ctx context.Context,
	cfg Config,
	redisClient *redis.Client,
	callJID string,
	callPhone string,
	isVideo bool,
) (bool, bool, string, error) {
	identity, err := workerRuntimeDatabaseIdentity(cfg)
	if err != nil {
		return false, false, "", err
	}
	rows, err := p.DB.QueryContext(ctx, `
		SELECT account_name, worker_name, worker_config_type_id::text,
			worker_config_status_id::text, value
		FROM read_whatsapp_worker_call_config(
			$1::uuid, $2::uuid, 'whatsmeow', $3, $4::uuid, $5, $6,
			$7::uuid, $8::uuid
		)
	`, cfg.WorkerID, cfg.AccountID, identity.Generation, identity.WriterEpoch,
		identity.Capability, identity.Container, rejectCallConfigTypeID,
		showCallMessageConfigTypeID)
	if err != nil {
		return false, false, "", err
	}
	defer rows.Close()
	var accountName, workerName, template string
	reject := false
	found := false
	for rows.Next() {
		found = true
		var configType, configStatus, value sql.NullString
		if err := rows.Scan(&accountName, &workerName, &configType, &configStatus, &value); err != nil {
			return false, false, "", err
		}
		if configStatus.String != activeWorkerConfigStatusID {
			continue
		}
		if configType.String == rejectCallConfigTypeID {
			reject = true
		} else if configType.String == showCallMessageConfigTypeID {
			template = strings.TrimSpace(value.String)
		}
	}
	if err := rows.Err(); err != nil {
		return false, false, "", err
	}
	if !found {
		return false, false, "", errors.New("worker runtime database fence rejected")
	}
	if template == "" {
		return reject, false, "", nil
	}
	fallback := replaceLocalCallTemplate(template, accountName, workerName, callPhone)
	if !dynamicCallTemplatePattern.MatchString(template) {
		return reject, strings.TrimSpace(fallback) != "", fallback, nil
	}
	text, err := renderIncomingCallTemplateDirect(ctx, incomingCallTemplateInput{
		AccountID:   cfg.AccountID,
		AccountName: accountName,
		WorkerID:    cfg.WorkerID,
		WorkerName:  workerName,
		CallJID:     callJID,
		CallPhone:   callPhone,
		IsVideo:     isVideo,
		Template:    template,
	}, newElasticIncomingCallChatStore(cfg, redisClient), p)
	if err != nil {
		// Rendering is deliberately best-effort: rejecting the provider call must
		// not depend on Elasticsearch, Redis or webhook enrichment availability.
		log.Printf("whatsmeow incoming call template enrichment unavailable worker_id=%s error_code=%s", cfg.WorkerID, safeOperationalErrorCode(err))
		return reject, strings.TrimSpace(fallback) != "", fallback, nil
	}
	return reject, strings.TrimSpace(text) != "", text, nil
}

func replaceLocalCallTemplate(template, accountName, workerName, phone string) string {
	now := time.Now()
	hour := now.Hour()
	greeting := "Boa noite"
	if hour >= 5 && hour < 12 {
		greeting = "Bom dia"
	} else if hour >= 12 && hour < 18 {
		greeting = "Boa tarde"
	}
	replacements := map[string]string{
		"greeting":     greeting,
		"date":         now.Format("02/01/2006"),
		"time":         now.Format("15:04"),
		"account_name": accountName,
		"accountname":  accountName,
		"channel_name": workerName,
		"channelname":  workerName,
		"phone":        regexp.MustCompile(`\D`).ReplaceAllString(phone, ""),
	}
	result := template
	for key, value := range replacements {
		pattern := regexp.MustCompile(`(?i)\{\{\s*` + regexp.QuoteMeta(key) + `\s*\}\}`)
		result = pattern.ReplaceAllString(result, value)
	}
	return result
}
