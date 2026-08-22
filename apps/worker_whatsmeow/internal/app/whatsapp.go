package app

import (
	"container/heap"
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
	_ "github.com/mattn/go-sqlite3"
	"github.com/redis/go-redis/v9"
	qrcode "github.com/skip2/go-qrcode"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waHistorySync"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

const inboundKafkaPublishMaxAttempts = 3
const inboundKafkaPublishBaseDelay = 250 * time.Millisecond
const inboundKafkaPublishMaxDelay = 2 * time.Second
const whatsmeowSessionReadyTimeout = 20 * time.Second
const whatsmeowSessionReadyPollInterval = 250 * time.Millisecond
const whatsmeowTransientDisconnectDebounce = 5 * time.Second
const whatsmeowRuntimeFenceCleanupTimeout = 3 * time.Second

type WhatsAppManager struct {
	cfg        Config
	kafka      *KafkaClient
	centrifugo *CentrifugoClient
	storage    *StorageClient
	redis      *redis.Client
	debug      *ConnectionLifecycleDebugLogger
	runtimeCtx context.Context
	postgres   *WorkerPostgres

	mu                   sync.RWMutex
	sessionMu            sync.Mutex
	connectionRequestMu  sync.Mutex
	inboundFenceMu       sync.Mutex
	inboundSpoolMu       sync.Mutex
	lifecycleMu          sync.Mutex
	historySyncMu        sync.Mutex
	historySyncGate      chan struct{}
	historySyncRunning   bool
	historyPending       *historySyncJob
	historyRunner        func(context.Context, *events.HistorySync)
	client               *whatsmeow.Client
	nativeStatusClient   *whatsmeow.Client
	nativeStatus         WhatsappConnectionStatus
	nativeStatusSourceID string
	// nativeStatusReader is a deterministic unit-test seam. Production managers
	// leave it nil and always read the live snapshot from the provider client.
	nativeStatusReader func(*whatsmeow.Client) events.ConnectionStatus
	// providerTransportStatusReader is a deterministic unit-test seam. Production
	// managers leave it nil and always inspect the live provider socket/login state.
	providerTransportStatusReader func(*whatsmeow.Client) (connected bool, loggedIn bool)
	nativeStatusPublishMu         sync.Mutex
	nativeStatusPublishPending    *nativeConnectionStatusPersistenceItem
	nativeStatusPublishActive     *nativeConnectionStatusPersistenceItem
	nativeStatusPublishRunning    bool
	nativeStatusPublishWake       chan struct{}
	nativeStatusPublishWaiters    []chan struct{}
	providerFlightMu              sync.Mutex
	providerStalled               map[*whatsmeow.Client]struct{}
	providerFlights               map[*whatsmeow.Client]map[string]struct{}
	providerStalledAt             time.Time
	providerQuarantined           atomic.Bool
	// providerQuarantineBeforeLock is a deterministic concurrency-test hook.
	// Production managers leave it nil.
	providerQuarantineBeforeLock func()
	incomingMediaOnce            sync.Once
	incomingMediaGate            chan struct{}
	connected                    bool
	status                       string
	code                         int
	rejectCalls                  bool

	lastKeepAliveAt         time.Time
	lastKeepAliveFailureAt  time.Time
	keepAliveFailures       int
	lastSendAttemptAt       time.Time
	lastSendSuccessAt       time.Time
	lastSendErrorAt         time.Time
	consecutiveSendFailures int
	degradedReason          string
	lastOutboundReconnectAt time.Time
	outboundStalledScope    *whatsAppRuntimeFence

	pendingFreshLogin              *freshLoginRequest
	currentQRCode                  string
	currentPairingCode             string
	currentPasskeyPublicKey        string
	currentPasskeyConfirmationCode string
	currentPasskeySkipHandoffUX    bool
	connectionAttemptID            string
	debugTraceID                   string
	qrGenerationCount              int
	qrReadSessionLocked            bool
	qrHash                         string
	qrReadSessionSerial            uint64
	qrReadSessionDone              chan struct{}
	callAutoReplySender            func(context.Context, ChatMessage, providerInvocationBoundary) (map[string]any, error)
	consumerBarrierReady           func() bool
	consumerBarrierInvalidate      func()
	notifyWorkerStatus             func(context.Context, ConnectionState) error
	persistNativeConnectionStatus  func(context.Context, ConnectionState, string, *workerConnectionStatusLeaseProof) error
	activateRuntimeFence           func(context.Context, WhatsappRuntimeFenceActivationRequest) (WhatsappRuntimeFenceActivationResponse, error)
	inboundConnectionScope         *whatsAppRuntimeFence
	ownedRuntimeConnectionFence    *WhatsappRuntimeOwnedConnectionFence
	authStoreDormant               bool
	// Deterministic unit-test seams. Production managers leave these nil.
	authStoreRuntimeFenceVerifier        func(context.Context, whatsAppRuntimeFence) error
	authStoreInitializer                 func(context.Context) error
	inboundSpoolPublished                map[string]struct{}
	providerLifecycleEventSerial         uint64
	runtimeFenceRecoveryMu               sync.Mutex
	runtimeFenceRecoveryCancel           context.CancelFunc
	runtimeFenceRecoveryClient           *whatsmeow.Client
	runtimeFenceRecoverySerial           uint64
	runtimeFenceRecoveryVerify           func(*whatsmeow.Client) bool
	runtimeFenceRecoveryRotate           func(context.Context, *whatsmeow.Client, string) (whatsAppRuntimeFence, error)
	runtimeFenceRecoveryBeforeApply      func()
	runtimeFenceRetryRandom              func() uint64
	typingSimulationLimiterOnce          sync.Once
	typingSimulationLimiter              *typingSimulationLimiter
	secureImportInProgress               atomic.Bool
	secureImportRevision                 atomic.Int64
	providerHandoffInProgress            atomic.Bool
	providerHandoffStage                 atomic.Pointer[whatsmeowImportStage]
	providerHandoffSnapshotResyncPending atomic.Bool
	providerHandoffAppStateResyncMu      sync.Mutex
	sourceProviderHandoffInProgress      atomic.Bool
	sourceProviderHandoffMu              sync.Mutex
	sourceProviderHandoffKey             string
	sourceProviderHandoffCheckpoint      *whatsmeowProviderHandoffCheckpoint
}

const (
	whatsmeowPhotoCachePrefix                                 = "photo:jid:"
	whatsmeowPhotoNoPhotoCachePrefix                          = "photo:no-photo:whatsmeow:jid:"
	whatsmeowPhotoCacheNoPhoto                                = "__no_photo__"
	whatsmeowPhotoCacheTTL                                    = 24 * time.Hour
	whatsmeowPhotoCacheNoPhotoTTL                             = 5 * time.Minute
	whatsmeowPhotoFetchTimeout                                = 5 * time.Second
	whatsmeowLogoutTimeout                                    = 30 * time.Second
	whatsmeowPairClientDesktop       whatsmeow.PairClientType = whatsmeow.PairClientElectron
	whatsmeowPairClientDisplayName                            = "Desktop (Mac OS)"
	maxQRCodeGenerations                                      = 5
)

type freshLoginRequest struct {
	Type  string
	Phone string
}

type historySyncCandidate struct {
	chatJID   types.JID
	message   *waHistorySync.HistorySyncMsg
	timestamp uint64
}

type historySyncJob struct {
	ctx context.Context
	evt *events.HistorySync
}

type providerLifecycleEventToken struct {
	serial        uint64
	capturedScope *whatsAppRuntimeFence
}

var ErrWhatsAppNotReady = errors.New("whatsmeow connection is not ready")

var (
	errWhatsmeowProviderClientFenced = errors.New("whatsmeow provider client is fenced")
	errWhatsmeowProviderCallInFlight = errors.New("whatsmeow provider operation is already in flight")
)

const providerStallLivenessGrace = 30 * time.Second

func (m *WhatsAppManager) beginProviderLifecycleEvent(
	captureScope bool,
) providerLifecycleEventToken {
	m.lifecycleMu.Lock()
	defer m.lifecycleMu.Unlock()
	m.cancelRuntimeFenceRecovery()
	return m.beginProviderLifecycleEventLocked(captureScope)
}

func (m *WhatsAppManager) beginProviderLifecycleEventLocked(
	captureScope bool,
) providerLifecycleEventToken {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.providerLifecycleEventSerial++
	token := providerLifecycleEventToken{serial: m.providerLifecycleEventSerial}
	if captureScope && m.inboundConnectionScope != nil {
		captured := *m.inboundConnectionScope
		token.capturedScope = &captured
	}
	return token
}

func (m *WhatsAppManager) beginFencedProviderLifecycleEvent() providerLifecycleEventToken {
	m.lifecycleMu.Lock()
	defer m.lifecycleMu.Unlock()
	m.cancelRuntimeFenceRecovery()
	token := m.beginProviderLifecycleEventLocked(true)
	// Keep lifecycle causality exact without holding m.mu across the worker
	// callback: no newer Connected event may begin before this invalidation.
	m.invalidateConsumerBarrier()
	return token
}

func (m *WhatsAppManager) isProviderLifecycleEventCurrent(serial uint64) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return serial != 0 && serial == m.providerLifecycleEventSerial
}

func (m *WhatsAppManager) applyProviderLifecycleState(
	serial uint64,
	apply func(),
) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	if serial == 0 || serial != m.providerLifecycleEventSerial {
		return false
	}
	apply()
	return true
}

func (m *WhatsAppManager) waitForProviderLifecycleDebounce(
	ctx context.Context,
	serial uint64,
	delay time.Duration,
) bool {
	if serial == 0 {
		return false
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return m.isProviderLifecycleEventCurrent(serial)
	}
}

func (m *WhatsAppManager) deactivateCapturedInboundConnectionScopeAsync(
	expected *whatsAppRuntimeFence,
) bool {
	// Event handlers must not wait behind a possibly slow runtime-fence
	// activation. The local scope is revoked synchronously under m.mu; the
	// durable CAS and exact-key cleanup run separately with a strict deadline.
	scope, detached := m.detachCapturedInboundConnectionScopeLocal(expected)
	if !detached {
		return false
	}
	go func() {
		ctx, cancel := context.WithTimeout(
			context.Background(),
			whatsmeowRuntimeFenceCleanupTimeout,
		)
		defer cancel()
		m.cleanupDetachedInboundConnectionScope(ctx, scope)
	}()
	return true
}

func (m *WhatsAppManager) scheduleTransientDisconnectPublication(serial uint64) {
	ctx := m.connectionContext()
	go func() {
		if !m.waitForProviderLifecycleDebounce(
			ctx,
			serial,
			whatsmeowTransientDisconnectDebounce,
		) {
			return
		}
		m.publishState(
			context.Background(),
			"connecting",
			CodeAwaitConnection,
			WorkerStatusDisponible,
			"",
			"",
			false,
		)
	}()
}

func (m *WhatsAppManager) setRejectCalls(enabled bool) {
	m.mu.Lock()
	m.rejectCalls = enabled
	m.mu.Unlock()
}

func (m *WhatsAppManager) rejectCallsEnabled() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.rejectCalls
}

func localConnectionStatusLog(event string, fields map[string]any) {
	if strings.ToUpper(os.Getenv("APP_ENVIRONMENT")) != "LOCAL" {
		return
	}
	if fields == nil {
		fields = map[string]any{}
	}
	sanitized := make(map[string]any, len(fields)+3)
	for key, value := range fields {
		sanitized[key] = sanitizeConnectionFlowValue(key, value)
	}
	fields = sanitized
	fields["event"] = event
	fields["timestamp"] = time.Now().UTC().Format(time.RFC3339Nano)
	if _, ok := fields["layer"]; !ok {
		fields["layer"] = "worker_whatsmeow"
	}
	payload, err := json.Marshal(fields)
	if err != nil {
		log.Printf("[LOCAL_CONNECTION_STATUS] {\"event\":\"%s\",\"marshal_error\":\"%s\"}", event, err.Error())
		return
	}
	log.Printf("[LOCAL_CONNECTION_STATUS] %s", payload)
}

func NewWhatsAppManager(ctx context.Context, cfg Config, kafka *KafkaClient, centrifugo *CentrifugoClient, storage *StorageClient, redisClient *redis.Client, postgres *WorkerPostgres, debugLoggers ...*ConnectionLifecycleDebugLogger) (*WhatsAppManager, error) {
	var debug *ConnectionLifecycleDebugLogger
	if len(debugLoggers) > 0 {
		debug = debugLoggers[0]
	}
	if postgres == nil || postgres.DB == nil {
		return nil, errors.New("worker database is required for runtime fence and status outbox")
	}
	notifyWorkerStatus := func(callCtx context.Context, state ConnectionState) error {
		return postgres.ApplyWorkerStatus(callCtx, cfg, state)
	}
	persistNativeConnectionStatus := func(callCtx context.Context, state ConnectionState, eventID string, leaseProof *workerConnectionStatusLeaseProof) error {
		return postgres.ApplyNativeConnectionStatus(callCtx, cfg, state, eventID, leaseProof)
	}
	activateRuntimeFence := func(callCtx context.Context, payload WhatsappRuntimeFenceActivationRequest) (WhatsappRuntimeFenceActivationResponse, error) {
		return postgres.ActivateRuntimeFence(callCtx, cfg, payload)
	}
	manager := &WhatsAppManager{
		cfg:                           cfg,
		kafka:                         kafka,
		centrifugo:                    centrifugo,
		storage:                       storage,
		redis:                         redisClient,
		debug:                         debug,
		runtimeCtx:                    ctx,
		postgres:                      postgres,
		status:                        "initial",
		code:                          CodeInfo,
		notifyWorkerStatus:            notifyWorkerStatus,
		persistNativeConnectionStatus: persistNativeConnectionStatus,
		activateRuntimeFence:          activateRuntimeFence,
		inboundSpoolPublished:         make(map[string]struct{}),
		nativeStatusPublishWake:       make(chan struct{}, 1),
		authStoreDormant:              cfg.DeferAuthStoreInitialization,
	}
	if cfg.OwnedConnectionEpoch != "" || cfg.OwnedConnectionAttemptID != "" {
		owned, ownedErr := normalizeAuthorizedRuntimeConnectionFence(
			cfg.OwnedConnectionAttemptID,
			cfg.OwnedConnectionEpoch,
		)
		if ownedErr != nil || owned == nil {
			return nil, errors.New("resolved WhatsApp runtime connection ownership is invalid")
		}
		manager.ownedRuntimeConnectionFence = owned
	}
	postgres.SetSessionLeaseLostHandler(manager.handleSessionLeaseLost)
	if cfg.DeferAuthStoreInitialization {
		manager.status = "disconnected"
		manager.code = CodeLoggedOut
		manager.degradedReason = "awaiting_authorized_connection"
		log.Printf(
			"whatsmeow auth store initialization deferred worker_id=%s runtime_generation=%d",
			cfg.WorkerID,
			cfg.RuntimeGeneration,
		)
	} else if err := manager.initClient(ctx); err != nil {
		if cfg.SessionStorage == SessionStoragePostgres {
			cleanupCtx, cleanupCancel := context.WithTimeout(
				context.WithoutCancel(ctx),
				workerDatabaseRecoveryTimeout,
			)
			cleanupErr := postgres.ReleaseSessionLease(cleanupCtx)
			cleanupCancel()
			if cleanupErr != nil {
				err = errors.Join(
					err,
					fmt.Errorf("release whatsapp session lease after initialization failure: %w", cleanupErr),
				)
			}
		}
		return nil, err
	}
	manager.startInboundSpoolPublisher(ctx)
	return manager, nil
}

func (m *WhatsAppManager) handleSessionLeaseLost() {
	if m == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), whatsmeowRuntimeFenceCleanupTimeout)
	defer cancel()
	_ = m.beginFencedProviderLifecycleEvent()
	m.deactivateInboundConnectionScope(ctx)
	m.invalidateConsumerBarrier()
	client := m.getClient()
	if client != nil {
		client.MarkConnectionLeaseLost()
		invalidateWhatsmeowClientCaches(client)
		m.stopAndPublishNativeConnectionStatus(ctx, client)
	}
	m.mu.Lock()
	m.connected = false
	m.status = "disconnected"
	m.code = CodeConnectionClosed
	m.degradedReason = "lease_lost"
	m.mu.Unlock()
	log.Printf("whatsmeow session lease lost worker_id=%s action=provider_closed", m.cfg.WorkerID)
}

func (m *WhatsAppManager) sessionDir() string {
	return filepath.Join(m.cfg.DataDir, "whatsmeow", m.cfg.WorkerID)
}

func (m *WhatsAppManager) initClient(ctx context.Context) error {
	var (
		container   *sqlstore.Container
		deviceStore *store.Device
		err         error
	)
	if m.cfg.SessionStorage == SessionStoragePostgres {
		if m.postgres == nil || m.postgres.DB == nil {
			return errors.New("worker database is unavailable for postgres session storage")
		}
		if err := m.postgres.AcquireSessionLease(ctx, m.cfg); err != nil {
			return wrapSafeOperationalError(safeCodeStartupSessionLeaseAcquireFailed, err)
		}
		sqlstore.PostgresArrayWrapper = func(value any) interface {
			driver.Valuer
			sql.Scanner
		} {
			return pq.Array(value)
		}
		container = sqlstore.NewWithDB(m.postgres.DB, "postgres", waLog.Noop)
		if m.cfg.WhatsappSessionDebugEnabled {
			container.SetSessionDebugOutput(func(line string) {
				log.Print(line)
			})
		}
		if err := container.ValidateSchemaVersion(ctx, sqlstore.SharedSchemaVersion); err != nil {
			return wrapSafeOperationalError(safeCodeStartupSessionSchemaValidateFailed, err)
		}
		container.ConfigurePostgresSessionOperations(func(_ context.Context, scope sqlstore.SessionScope) (sqlstore.OperationFence, error) {
			if scope.SessionID != m.cfg.WorkerID {
				return sqlstore.OperationFence{}, errors.New("whatsapp session operation scope mismatch")
			}
			ownerID, token, generation, epoch, capability, fenceErr := m.postgres.SessionOperationFence()
			if fenceErr != nil {
				return sqlstore.OperationFence{}, fenceErr
			}
			return sqlstore.OperationFence{
				OwnerID: ownerID, FencingToken: token,
				Generation: int64(generation), Epoch: epoch,
				Capability: capability,
			}, nil
		})
		revisionID := m.secureImportRevision.Load()
		revisionStatus := "validating"
		if !m.secureImportInProgress.Load() {
			if err := m.postgres.recoverInterruptedWhatsmeowImport(ctx, m.cfg); err != nil {
				return wrapSafeOperationalError(
					safeCodeStartupSessionRecoveryFailed,
					fmt.Errorf("recover interrupted whatsmeow import: %w", err),
				)
			}
			opened, revisionErr := m.postgres.openSessionRevision(ctx, m.cfg)
			if revisionErr != nil {
				return wrapSafeOperationalError(safeCodeStartupSessionRevisionOpenFailed, revisionErr)
			}
			revisionID = opened.RevisionID
			revisionStatus = opened.Status
			m.providerHandoffInProgress.Store(false)
			m.providerHandoffStage.Store(nil)
			m.providerHandoffSnapshotResyncPending.Store(false)
			if opened.HandoffID.Valid {
				stage, hydrateErr := m.postgres.hydrateWhatsmeowProviderHandoff(
					ctx, m.cfg, revisionID, opened.HandoffID.String,
				)
				if hydrateErr != nil {
					handoffErrorCode := safeWhatsmeowHandoffErrorCode(hydrateErr)
					log.Printf(
						"whatsmeow provider handoff hydration failed worker_id=%s revision=%d error_code=%s",
						m.cfg.WorkerID,
						revisionID,
						handoffErrorCode,
					)
					rollbackCtx, rollbackCancel := context.WithTimeout(
						context.WithoutCancel(ctx), workerDatabaseRecoveryTimeout,
					)
					rollbackErr := m.postgres.rollbackWhatsmeowProviderHandoffCandidate(
						rollbackCtx, m.cfg, revisionID, opened.HandoffID.String,
						handoffErrorCode,
					)
					rollbackCancel()
					if rollbackErr != nil {
						return wrapSafeOperationalError(
							safeCodeStartupHandoffRollbackFailed,
							errors.Join(
								fmt.Errorf("hydrate whatsapp provider handoff: %w", hydrateErr),
								fmt.Errorf("rollback failed whatsapp provider handoff: %w", rollbackErr),
							),
						)
					}
					return wrapSafeOperationalError(
						safeCodeStartupHandoffHydrateFailed,
						fmt.Errorf("hydrate whatsapp provider handoff: %w", hydrateErr),
					)
				}
				if stage.CandidateRevision != revisionID || stage.HandoffID != opened.HandoffID.String {
					return wrapSafeOperationalError(
						safeCodeStartupHandoffScopeChanged,
						errors.New("hydrated whatsapp provider handoff scope changed"),
					)
				}
				revisionStatus = "validating"
				stageCopy := stage
				m.providerHandoffStage.Store(&stageCopy)
				m.providerHandoffInProgress.Store(true)
				m.providerHandoffSnapshotResyncPending.Store(
					stageCopy.AppStateSnapshotResyncPending,
				)
			}
		} else if revisionID <= 0 {
			return errors.New("whatsapp secure import revision is invalid")
		}
		if m.cfg.SessionStorageMigrationID != "" && revisionStatus == "staging" {
			if err := m.bootstrapLegacyVolumeMigration(ctx, revisionID); err != nil {
				return wrapSafeOperationalError(safeCodeStartupSessionRevisionOpenFailed, err)
			}
			revisionStatus = "validating"
		}
		deviceStore, err = container.GetDeviceForSession(ctx, m.cfg.WorkerID, revisionID)
		if m.providerHandoffInProgress.Load() &&
			(err != nil || deviceStore == nil || deviceStore.ID == nil) {
			openErr := err
			if openErr == nil {
				openErr = errors.New("hydrated whatsapp handoff has no device identity")
			}
			rollbackErr := m.rollbackActiveProviderHandoff(ctx, "candidate_open_failed")
			if rollbackErr != nil {
				return wrapSafeOperationalError(
					safeCodeStartupHandoffRollbackFailed,
					errors.Join(openErr, rollbackErr),
				)
			}
			return wrapSafeOperationalError(safeCodeStartupSessionDeviceOpenFailed, openErr)
		}
		logWhatsappSessionDebug(m.cfg.WhatsappSessionDebugEnabled, "provider_open", map[string]any{
			"session_id": m.cfg.WorkerID,
			"provider":   "whatsmeow",
			"revision":   revisionID,
			"stage":      revisionStatus,
		})
		log.Printf("initializing whatsmeow client worker_id=%s revision_id=%d session_storage=postgres", m.cfg.WorkerID, revisionID)
	} else {
		storeDir := m.sessionDir()
		if err := os.MkdirAll(storeDir, 0o755); err != nil {
			return err
		}
		dbPath := filepath.Join(storeDir, "store.db")
		log.Printf("initializing whatsmeow client worker_id=%s session_storage=legacy_volume store=%s", m.cfg.WorkerID, dbPath)
		container, err = sqlstore.New(ctx, "sqlite3", "file:"+dbPath+"?_foreign_keys=on", waLog.Noop)
		if err == nil {
			deviceStore, err = container.GetFirstDevice(ctx)
		}
	}
	if err != nil {
		return wrapSafeOperationalError(safeCodeStartupSessionDeviceOpenFailed, err)
	}
	client := whatsmeow.NewClient(deviceStore, newSafeWhatsmeowLogger(m.cfg.WhatsappSessionDebugEnabled))
	if proxy := m.cfg.ProxyURL(); proxy != "" {
		if err := client.SetProxyAddress(proxy); err != nil {
			log.Printf("failed to configure proxy error_code=%s", safeOperationalErrorCode(err))
		} else {
			log.Printf("whatsmeow proxy configured worker_id=%s protocol=%s host=%s port=%d", m.cfg.WorkerID, m.cfg.ProxyProtocol, m.cfg.ProxyHost, m.cfg.ProxyPort)
		}
	}
	client.AddEventHandler(func(evt any) {
		m.handleEventFromClient(client, evt)
	})

	m.mu.Lock()
	m.client = client
	m.mu.Unlock()
	m.installNativeConnectionStatus(client)
	m.startProviderHandoffAppStateSnapshotResyncTimeout()
	log.Printf("whatsmeow client initialized worker_id=%s has_store_id=%t", m.cfg.WorkerID, deviceStore.ID != nil)
	return nil
}

func (m *WhatsAppManager) Bootstrap(ctx context.Context) {
	if m.isProviderProcessQuarantined() {
		log.Printf(
			"whatsmeow bootstrap rejected for quarantined process worker_id=%s",
			m.cfg.WorkerID,
		)
		return
	}
	client := m.getClient()
	if client == nil || client.Store.ID == nil {
		log.Printf("whatsmeow bootstrap skipped worker_id=%s has_client=%t has_store_id=%t", m.cfg.WorkerID, client != nil, client != nil && client.Store.ID != nil)
		return
	}
	if m.isAuthenticated(client) {
		log.Printf("whatsmeow bootstrap skipped worker_id=%s reason=already_authenticated", m.cfg.WorkerID)
		lifecycleEvent := m.beginProviderLifecycleEvent(false)
		scope, err := m.activateVerifiedInboundConnectionScope(
			ctx,
			client,
			"bootstrap-already-authenticated",
		)
		if err != nil {
			log.Printf(
				"whatsmeow bootstrap runtime fence activation skipped worker_id=%s generation=%d error_code=%s",
				m.cfg.WorkerID,
				m.cfg.RuntimeGeneration,
				safeOperationalErrorCode(err),
			)
			if !m.applyProviderLifecycleState(lifecycleEvent.serial, func() {
				m.connected = false
				m.status = "connecting"
				m.code = CodeAwaitConnection
				m.degradedReason = "runtime_fence_activation_failed"
			}) {
				return
			}
			m.publishState(context.Background(), "connecting", CodeAwaitConnection, WorkerStatusDisponible, "", "", false)
			m.scheduleRuntimeFenceRecovery(
				client,
				"bootstrap-already-authenticated",
				lifecycleEvent.serial,
			)
			return
		}
		if !m.applyProviderLifecycleState(lifecycleEvent.serial, func() {
			m.connected = true
			m.status = "connected"
			m.code = CodeConnectionEstablished
			m.lastKeepAliveAt = time.Now()
			m.keepAliveFailures = 0
			m.consecutiveSendFailures = 0
			m.degradedReason = ""
		}) {
			m.deactivateCapturedInboundConnectionScopeAsync(&scope)
			return
		}
		m.publishConnectedWhenReadyForScope(
			context.Background(),
			scope,
			"bootstrap-already-authenticated",
			phoneFromOwnID(client.Store.ID),
			false,
		)
		return
	}
	if client.IsConnected() {
		log.Printf("whatsmeow bootstrap skipped worker_id=%s reason=already_connected", m.cfg.WorkerID)
		m.publishState(context.Background(), "connecting", CodeAwaitConnection, WorkerStatusDisponible, "", "", false)
		return
	}
	go func() {
		log.Printf("whatsmeow bootstrap connect starting worker_id=%s", m.cfg.WorkerID)
		m.setState("connecting", CodeAwaitConnection, "")
		if err := m.connectClient(ctx, client, "bootstrap"); err != nil {
			log.Printf("whatsmeow bootstrap connect failed worker_id=%s error_code=%s", m.cfg.WorkerID, safeOperationalErrorCode(err))
			if rollbackErr := m.rollbackActiveProviderHandoff(ctx, "bootstrap_connect_failed"); rollbackErr != nil {
				log.Printf(
					"whatsapp provider handoff rollback failed worker_id=%s error_code=%s",
					m.cfg.WorkerID, safeOperationalErrorCode(rollbackErr),
				)
			}
			m.publishState(context.Background(), "connecting", CodeAwaitConnection, WorkerStatusDisponible, "", "", false)
		}
	}()
}

func (m *WhatsAppManager) getClient() *whatsmeow.Client {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.client
}

func (m *WhatsAppManager) providerTransportStatus(client *whatsmeow.Client) (connected bool, loggedIn bool) {
	if client == nil {
		return false, false
	}
	m.mu.RLock()
	reader := m.providerTransportStatusReader
	m.mu.RUnlock()
	if reader != nil {
		return reader(client)
	}
	return client.IsConnected(), client.IsLoggedIn()
}

func (m *WhatsAppManager) acquireProviderClientFlight(
	client *whatsmeow.Client,
	operation string,
) (func(), error) {
	if client == nil {
		return nil, errors.New("whatsmeow client is not initialized")
	}
	operation = strings.TrimSpace(operation)
	if operation == "" {
		return nil, errors.New("whatsmeow provider operation is required")
	}
	if m.isProviderProcessQuarantined() {
		return nil, errWhatsmeowProviderClientFenced
	}
	if m.sourceProviderHandoffInProgress.Load() {
		return nil, errors.New("whatsmeow provider handoff has fenced new operations")
	}

	m.providerFlightMu.Lock()
	defer m.providerFlightMu.Unlock()
	// markProviderClientStalled publishes the sticky process quarantine while
	// holding this same lock. Recheck while serialized so a fresh client cannot
	// slip into the process as the old context-ignoring call is quarantined.
	if m.providerQuarantined.Load() {
		return nil, errWhatsmeowProviderClientFenced
	}
	if m.sourceProviderHandoffInProgress.Load() {
		return nil, errors.New("whatsmeow provider handoff has fenced new operations")
	}
	if _, blocked := m.providerStalled[client]; blocked {
		return nil, errWhatsmeowProviderClientFenced
	}
	if m.providerFlights == nil {
		m.providerFlights = make(map[*whatsmeow.Client]map[string]struct{})
	}
	flights := m.providerFlights[client]
	if flights == nil {
		flights = make(map[string]struct{})
		m.providerFlights[client] = flights
	}
	if _, exists := flights[operation]; exists {
		return nil, errWhatsmeowProviderCallInFlight
	}
	flights[operation] = struct{}{}

	var once sync.Once
	return func() {
		once.Do(func() {
			m.providerFlightMu.Lock()
			defer m.providerFlightMu.Unlock()
			current := m.providerFlights[client]
			delete(current, operation)
			if len(current) == 0 {
				delete(m.providerFlights, client)
			}
		})
	}, nil
}

func (m *WhatsAppManager) acquireIncomingMediaDownload(
	ctx context.Context,
) (func(), error) {
	if m == nil {
		return nil, errors.New("whatsmeow manager is required")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	m.incomingMediaOnce.Do(func() {
		m.incomingMediaGate = make(
			chan struct{},
			maxConcurrentIncomingMediaDownloads,
		)
	})
	select {
	case m.incomingMediaGate <- struct{}{}:
		var once sync.Once
		return func() {
			once.Do(func() {
				<-m.incomingMediaGate
			})
		}, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (m *WhatsAppManager) markProviderClientStalled(
	client *whatsmeow.Client,
) {
	// Quarantine is process-wide and irreversible. Replacing a client or
	// rotating a runtime fence cannot prove that the context-ignoring provider
	// goroutine stopped mutating shared SDK/session state. Only a new process
	// owns a clean manager and may activate a successor runtime.
	if m.providerQuarantineBeforeLock != nil {
		m.providerQuarantineBeforeLock()
	}
	m.providerFlightMu.Lock()
	// This mutex is the linearization boundary shared with provider admission:
	// either an admission records its flight first, or quarantine becomes
	// visible first and every later admission is rejected.
	m.providerQuarantined.Store(true)
	if m.providerStalled == nil {
		m.providerStalled = make(map[*whatsmeow.Client]struct{})
	}
	if client != nil {
		m.providerStalled[client] = struct{}{}
	}
	if m.providerStalledAt.IsZero() {
		m.providerStalledAt = time.Now()
	}
	m.providerFlightMu.Unlock()
}

func (m *WhatsAppManager) isProviderProcessQuarantined() bool {
	return m != nil && m.providerQuarantined.Load()
}

func (m *WhatsAppManager) isProviderClientStalled(
	client *whatsmeow.Client,
) bool {
	if client == nil {
		return false
	}
	m.providerFlightMu.Lock()
	defer m.providerFlightMu.Unlock()
	_, blocked := m.providerStalled[client]
	return blocked
}

func (m *WhatsAppManager) providerStallLivenessFatal(
	now time.Time,
) bool {
	if m == nil {
		return false
	}
	m.providerFlightMu.Lock()
	stalledAt := m.providerStalledAt
	m.providerFlightMu.Unlock()
	if stalledAt.IsZero() {
		return false
	}
	if now.IsZero() {
		now = time.Now()
	}
	return !now.Before(stalledAt.Add(providerStallLivenessGrace))
}

func (m *WhatsAppManager) quarantineProviderClient(
	client *whatsmeow.Client,
	operation string,
	cause error,
) {
	m.markProviderClientStalled(client)
	if m.getClient() != client {
		return
	}

	lifecycleEvent := m.beginFencedProviderLifecycleEvent()
	if lifecycleEvent.capturedScope != nil {
		m.deactivateCapturedInboundConnectionScopeAsync(
			lifecycleEvent.capturedScope,
		)
	}
	m.applyProviderLifecycleState(lifecycleEvent.serial, func() {
		m.connected = false
		m.status = "connecting"
		m.code = CodeAwaitConnection
		if m.degradedReason == "" {
			m.degradedReason = "provider_call_stalled"
		}
	})
	log.Printf(
		"whatsmeow provider client quarantined worker_id=%s operation=%s error_code=%s",
		m.cfg.WorkerID,
		operation,
		safeOperationalErrorCode(cause),
	)
	if m.centrifugo != nil {
		go m.publishState(
			context.Background(),
			"connecting",
			CodeAwaitConnection,
			WorkerStatusDisponible,
			"",
			"",
			false,
		)
	}
}

func invokeWhatsmeowProviderOperationWithDeadline[T any](
	ctx context.Context,
	manager *WhatsAppManager,
	client *whatsmeow.Client,
	operation string,
	timeout time.Duration,
	invoke func(context.Context) (T, error),
) (T, error) {
	var zero T
	if manager == nil {
		return zero, errors.New("whatsmeow manager is required")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if invoke == nil {
		return zero, errors.New("whatsmeow provider invocation is required")
	}
	release, err := manager.acquireProviderClientFlight(client, operation)
	if err != nil {
		return zero, err
	}
	if timeout <= 0 {
		timeout = defaultProviderInvocationTimeout
	}
	if deadline, ok := ctx.Deadline(); ok {
		remaining := time.Until(deadline)
		if remaining < timeout {
			timeout = remaining
		}
	}
	if timeout <= 0 {
		release()
		return zero, context.DeadlineExceeded
	}

	providerCtx, cancel := context.WithTimeout(
		context.WithoutCancel(ctx),
		timeout,
	)
	defer cancel()
	result := make(chan providerInvocationResult[T], 1)
	go func() {
		defer release()
		value, invokeErr := invoke(providerCtx)
		result <- providerInvocationResult[T]{value: value, err: invokeErr}
	}()

	stall := func(cause error) (T, error) {
		manager.quarantineProviderClient(client, operation, cause)
		go manager.triggerConnectionResetWithForce(
			context.WithoutCancel(ctx),
			"provider_call_stalled",
			cause,
			true,
		)
		observeLateProviderInvocation(result)
		return zero, cause
	}
	select {
	case outcome := <-result:
		return outcome.value, outcome.err
	case <-providerCtx.Done():
		return stall(fmt.Errorf(
			"%w: operation=%s: %w",
			errOutboundProviderCallStalled,
			operation,
			providerCtx.Err(),
		))
	case <-ctx.Done():
		return stall(fmt.Errorf(
			"%w: operation=%s: %w",
			errOutboundProviderCallStalled,
			operation,
			ctx.Err(),
		))
	}
}

func hasDeletedStore(client *whatsmeow.Client) bool {
	return client != nil && client.Store != nil && client.Store.Deleted
}

func (m *WhatsAppManager) setAuthStoreDormant(dormant bool) {
	m.mu.Lock()
	m.authStoreDormant = dormant
	m.mu.Unlock()
}

func (m *WhatsAppManager) verifyAuthStoreRuntimeFence(
	ctx context.Context,
	scope whatsAppRuntimeFence,
) error {
	if m.authStoreRuntimeFenceVerifier != nil {
		return m.authStoreRuntimeFenceVerifier(ctx, scope)
	}
	return m.verifyInboundConnectionScope(ctx, scope)
}

func (m *WhatsAppManager) initializeAuthStore(ctx context.Context) error {
	if m.authStoreInitializer != nil {
		return m.authStoreInitializer(ctx)
	}
	return m.initClient(ctx)
}

func (m *WhatsAppManager) initializeClientUnderActiveRuntimeFence(
	ctx context.Context,
	reason string,
) error {
	m.sessionMu.Lock()
	defer m.sessionMu.Unlock()

	client := m.getClient()
	if client != nil && client.Store != nil && !client.Store.Deleted {
		m.setAuthStoreDormant(false)
		return nil
	}

	m.inboundFenceMu.Lock()
	defer m.inboundFenceMu.Unlock()
	m.mu.RLock()
	var scope whatsAppRuntimeFence
	if m.inboundConnectionScope != nil {
		scope = *m.inboundConnectionScope
	}
	m.mu.RUnlock()
	if !scope.isValid() {
		return errors.New("authorized runtime connection fence is required before opening the WhatsApp auth store")
	}
	if err := m.verifyAuthStoreRuntimeFence(ctx, scope); err != nil {
		return fmt.Errorf("verify WhatsApp auth-store runtime fence: %w", err)
	}

	if client != nil {
		m.closeCurrentWhatsmeowClient()
	}
	if err := m.initializeAuthStore(ctx); err != nil {
		return fmt.Errorf("initialize WhatsApp auth store after %s: %w", reason, err)
	}
	m.setAuthStoreDormant(false)
	return nil
}

func (m *WhatsAppManager) ensureUsableClientForLogin(ctx context.Context, reason string) (*whatsmeow.Client, error) {
	client := m.getClient()
	if client != nil && client.Store != nil && !client.Store.Deleted {
		return client, nil
	}

	log.Printf(
		"whatsmeow login client reinit required worker_id=%s reason=%s has_client=%t has_store=%t store_deleted=%t",
		m.cfg.WorkerID,
		reason,
		client != nil,
		client != nil && client.Store != nil,
		hasDeletedStore(client),
	)

	if err := m.initializeClientUnderActiveRuntimeFence(ctx, reason); err != nil {
		return nil, err
	}

	client = m.getClient()
	if client == nil || client.Store == nil || client.Store.Deleted {
		return nil, fmt.Errorf("client is not initialized")
	}

	return client, nil
}

func (m *WhatsAppManager) clearLocalSessionFiles() error {
	if m.cfg.SessionStorage == SessionStoragePostgres {
		return nil
	}
	storeDir := m.sessionDir()
	if err := os.RemoveAll(storeDir); err != nil {
		return err
	}
	return os.MkdirAll(storeDir, 0o755)
}

func invalidateWhatsmeowClientCaches(client *whatsmeow.Client) {
	if client != nil && client.Store != nil {
		client.Store.InvalidateCaches()
	}
}

// SuspendForDatabaseOutage is a non-destructive fail-closed transition. It
// revokes the runtime fence before disconnecting the provider, which also
// makes every Kafka consumer lose its owner scope. No session row or local
// file is deleted here.
func (m *WhatsAppManager) SuspendForDatabaseOutage(ctx context.Context) {
	_ = m.beginFencedProviderLifecycleEvent()
	m.deactivateInboundConnectionScope(ctx)
	client := m.getClient()
	if client != nil {
		// Revalidate the database-backed fence before shutdown. An unsafe lease
		// becomes the canonical lease_lost state instead of a generic stop.
		_ = client.GetConnectionStatus()
		invalidateWhatsmeowClientCaches(client)
		client.Disconnect()
	}
	m.mu.Lock()
	m.connected = false
	m.status = "connecting"
	m.code = CodeAwaitConnection
	m.degradedReason = "worker_database_unavailable"
	m.mu.Unlock()
}

// PrepareDatabaseRecoveryFence reacquires the durable/Redis fence before a
// provider reconnect is attempted. Provider readiness remains false until the
// reconnect is authenticated, so consumers cannot start on this early scope.
func (m *WhatsAppManager) PrepareDatabaseRecoveryFence(ctx context.Context) error {
	_, err := m.replaceInboundConnectionScope(ctx)
	return err
}

func (m *WhatsAppManager) ResumeAfterDatabaseRecovery(_ context.Context) error {
	if m.cfg.SessionStorage == SessionStoragePostgres {
		client := m.getClient()
		if client == nil || !client.MarkConnectionLeaseAcquired() {
			return errors.New("whatsmeow client rejected the reacquired session lease")
		}
	}
	m.mu.Lock()
	m.connected = false
	m.status = "connecting"
	m.code = CodeAwaitConnection
	m.degradedReason = ""
	m.mu.Unlock()
	// Bootstrap connects asynchronously, so it must inherit the worker runtime
	// context rather than the short recovery-attempt timeout.
	m.Bootstrap(m.connectionContext())
	return nil
}

func (m *WhatsAppManager) IsConnected() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.connected
}

func (m *WhatsAppManager) IsReady() bool {
	return m.outboundReadinessReason() == ""
}

func (m *WhatsAppManager) WaitUntilReady(ctx context.Context, timeout time.Duration) error {
	if m.IsReady() {
		return nil
	}
	if timeout <= 0 {
		return fmt.Errorf("%w: %s", ErrWhatsAppNotReady, m.outboundReadinessReason())
	}
	waitCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-waitCtx.Done():
			return fmt.Errorf("%w after %s: %s: %w", ErrWhatsAppNotReady, timeout, m.outboundReadinessReason(), waitCtx.Err())
		case <-ticker.C:
			if m.IsReady() {
				return nil
			}
		}
	}
}

func (m *WhatsAppManager) outboundReadinessReason() string {
	if m.providerHandoffSnapshotResyncPending.Load() {
		return "app_state_snapshot_resync_pending"
	}
	client := m.getClient()
	if client == nil {
		return "client_not_initialized"
	}
	clientConnected, loggedIn := m.providerTransportStatus(client)
	if !clientConnected {
		return "client_socket_disconnected"
	}
	if !loggedIn {
		return "client_not_logged_in"
	}

	m.mu.RLock()
	connectedEvent := m.connected
	m.mu.RUnlock()

	if !connectedEvent {
		return "connection_event_disconnected"
	}
	return ""
}

func (m *WhatsAppManager) ConnectionHealth() map[string]any {
	appStateSnapshotResyncPending := m.providerHandoffSnapshotResyncPending.Load()
	client := m.getClient()
	clientConnected, loggedIn := m.providerTransportStatus(client)
	hasStoreID := client != nil && client.Store != nil && client.Store.ID != nil
	phone := ""
	if hasStoreID {
		phone = phoneFromOwnID(client.Store.ID)
	}
	hasPhone := phone != ""
	authenticated := loggedIn && hasStoreID && hasPhone

	m.mu.RLock()
	connectedEvent := m.connected
	status := m.status
	lastKeepAliveAt := m.lastKeepAliveAt
	lastKeepAliveFailureAt := m.lastKeepAliveFailureAt
	keepAliveFailures := m.keepAliveFailures
	lastSendAttemptAt := m.lastSendAttemptAt
	lastSendSuccessAt := m.lastSendSuccessAt
	lastSendErrorAt := m.lastSendErrorAt
	consecutiveSendFailures := m.consecutiveSendFailures
	degradedReason := m.degradedReason
	// Detaching a quarantined runtime revokes its local fence immediately, but
	// it does not mean the context-ignoring provider flight recovered. Keep the
	// stall visible until a different runtime fence is activated. A successor
	// scope is the only boundary that can make health/send admission fresh.
	outboundProviderStalled := m.isProviderProcessQuarantined() ||
		(m.outboundStalledScope != nil &&
			(m.inboundConnectionScope == nil ||
				sameWhatsAppRuntimeFenceIdentity(
					*m.outboundStalledScope,
					*m.inboundConnectionScope,
				)))
	m.mu.RUnlock()

	outboundFailureThreshold := normalizeOutboundFailureThreshold(m.cfg.OutboundFailureReconnectThreshold)
	outboundFailuresDegraded := outboundFailuresShouldDegrade(consecutiveSendFailures, outboundFailureThreshold)
	nativeStatus, nativeStatusSourceID, nativeSourceCurrent, nativeLeaseRequired, nativeLeaseProofValid :=
		m.nativeConnectionStatusHealthEvidence()
	nativeConnectionOnline := whatsappConnectionStatusOnline(nativeStatus)
	nativeProofReady := nativeConnectionOnline && nativeSourceCurrent && nativeLeaseProofValid
	effectiveDegradedReason := degradedReason
	if effectiveDegradedReason == "outbound_send_failed" && !outboundFailuresDegraded {
		effectiveDegradedReason = ""
	}
	if effectiveDegradedReason == "outbound_send_stalled" && !outboundProviderStalled {
		effectiveDegradedReason = ""
	}

	if appStateSnapshotResyncPending {
		effectiveDegradedReason = "app_state_snapshot_resync_pending"
	} else if effectiveDegradedReason == "" {
		switch {
		case !connectedEvent:
			effectiveDegradedReason = "connection_event_disconnected"
		case !clientConnected:
			effectiveDegradedReason = "client_socket_disconnected"
		case !loggedIn:
			effectiveDegradedReason = "client_not_logged_in"
		case !hasStoreID:
			effectiveDegradedReason = "missing_store_id"
		case !hasPhone:
			effectiveDegradedReason = "missing_self_phone"
		case outboundFailuresDegraded:
			effectiveDegradedReason = "outbound_failures"
		case !nativeConnectionOnline:
			effectiveDegradedReason = "native_connection_not_online"
		case !nativeSourceCurrent:
			effectiveDegradedReason = "native_connection_status_source_invalid"
		case nativeLeaseRequired && !nativeLeaseProofValid:
			effectiveDegradedReason = "session_lease_proof_unavailable"
		}
	}

	providerCanReceiveRuntime := connectedEvent && clientConnected && loggedIn
	canReceiveRuntime := providerCanReceiveRuntime && nativeProofReady &&
		!appStateSnapshotResyncPending
	ready := canReceiveRuntime &&
		authenticated &&
		!outboundFailuresDegraded &&
		!outboundProviderStalled &&
		effectiveDegradedReason == ""
	healthStatus := "connected"
	if !ready {
		if connectedEvent || clientConnected || loggedIn {
			healthStatus = "degraded"
		} else {
			healthStatus = "disconnected"
		}
	}
	return map[string]any{
		"status":                              healthStatus,
		"provider":                            "whatsmeow",
		"session_storage":                     m.cfg.SessionStorage,
		"ready":                               ready,
		"connected":                           ready,
		"session_ready":                       ready,
		"can_send":                            ready,
		"can_receive_runtime":                 canReceiveRuntime,
		"authenticated":                       authenticated,
		"phone":                               phone,
		"provider_state":                      healthStatus,
		"connected_event":                     connectedEvent,
		"client_connected":                    clientConnected,
		"logged_in":                           loggedIn,
		"has_store_id":                        hasStoreID,
		"has_phone":                           hasPhone,
		"manager_status":                      status,
		"last_keepalive_at":                   healthTime(lastKeepAliveAt),
		"last_keepalive_failure_at":           healthTime(lastKeepAliveFailureAt),
		"keepalive_failures":                  keepAliveFailures,
		"keepalive_warning":                   keepAliveFailures > 0,
		"last_send_attempt_at":                healthTime(lastSendAttemptAt),
		"last_send_success_at":                healthTime(lastSendSuccessAt),
		"last_send_error_at":                  healthTime(lastSendErrorAt),
		"consecutive_send_failures":           consecutiveSendFailures,
		"outbound_failure_threshold":          outboundFailureThreshold,
		"outbound_provider_stalled":           outboundProviderStalled,
		"degraded_reason":                     effectiveDegradedReason,
		"last_probe_at":                       time.Now().UTC().Format(time.RFC3339Nano),
		"probe_latency_ms":                    0,
		"connection_status":                   nativeStatus,
		"connection_status_source_id":         nativeStatusSourceID,
		"native_connection_online":            nativeConnectionOnline,
		"connection_status_source_current":    nativeSourceCurrent,
		"connection_status_lease_required":    nativeLeaseRequired,
		"connection_status_lease_proof_valid": nativeLeaseProofValid,
		"app_state_snapshot_resync_pending":   appStateSnapshotResyncPending,
	}
}

func healthTime(value time.Time) string {
	if value.IsZero() {
		return ""
	}
	return value.UTC().Format(time.RFC3339Nano)
}

func normalizeOutboundFailureThreshold(threshold int) int {
	if threshold <= 0 {
		return 3
	}
	return threshold
}

func outboundFailuresShouldDegrade(consecutiveFailures, threshold int) bool {
	return consecutiveFailures >= normalizeOutboundFailureThreshold(threshold)
}

func (m *WhatsAppManager) recordOutboundAttempt(ctx context.Context, data ChatMessage) {
	now := time.Now()
	m.mu.Lock()
	m.lastSendAttemptAt = now
	m.mu.Unlock()
}

func (m *WhatsAppManager) recordOutboundSuccess(ctx context.Context, data ChatMessage, elapsed time.Duration, externalID string) {
	now := time.Now()
	scope, hasScope := inboundConnectionScopeFromContext(ctx)
	m.mu.Lock()
	m.lastSendSuccessAt = now
	if hasScope &&
		m.outboundStalledScope != nil &&
		sameWhatsAppRuntimeFenceIdentity(*m.outboundStalledScope, scope) {
		// Another callback from the quarantined runtime may settle after the
		// watchdog. Its late success cannot make that runtime send-capable
		// again; only activation of a different fence may recover health.
		m.mu.Unlock()
		return
	}
	m.consecutiveSendFailures = 0
	if m.degradedReason == "outbound_send_failed" {
		m.degradedReason = ""
	}
	m.mu.Unlock()
}

// recordOutboundFailureWithInvocation separates a message-local/pre-provider
// failure from evidence that the WhatsApp transport itself is unhealthy.
// Local validation, typing, authorization and parent-context failures remain
// observable, but they cannot degrade the provider or stop all Kafka readers.
func (m *WhatsAppManager) recordOutboundFailureWithInvocation(
	ctx context.Context,
	data ChatMessage,
	elapsed time.Duration,
	err error,
	providerInvoked bool,
) {
	if providerInvoked && isRealOutboundTransportFailure(err) {
		m.recordOutboundFailure(ctx, data, elapsed, err)
		return
	}
	m.mu.Lock()
	m.lastSendErrorAt = time.Now()
	m.mu.Unlock()
}

func isRealOutboundTransportFailure(err error) bool {
	if err == nil ||
		errors.Is(err, context.Canceled) ||
		errors.Is(err, errTypingSimulationLocalDeadline) ||
		errors.Is(err, errTypingSimulationSaturated) ||
		errors.Is(err, errWhatsAppRuntimeFenceRevoked) ||
		errors.Is(err, errKafkaConsumerDispatchRevoked) ||
		errors.Is(err, ErrWhatsAppNotReady) ||
		isOutboundTargetBusinessRejection(err) {
		return false
	}
	var unsupported UnsupportedFeatureError
	return !errors.As(err, &unsupported)
}

func (m *WhatsAppManager) recordOutboundFailure(ctx context.Context, data ChatMessage, elapsed time.Duration, err error) {
	now := time.Now()
	m.mu.Lock()
	m.lastSendErrorAt = now
	if isOutboundTargetBusinessRejection(err) {
		m.mu.Unlock()
		return
	}
	m.consecutiveSendFailures++
	failures := m.consecutiveSendFailures
	m.degradedReason = "outbound_send_failed"
	m.mu.Unlock()

	if reason := outboundFailureResetReason(
		failures,
		m.cfg.OutboundFailureReconnectThreshold,
		err,
	); reason != "" {
		m.triggerConnectionReset(ctx, reason, err)
	}
}

func (m *WhatsAppManager) recordOutboundProviderStall(
	ctx context.Context,
	data ChatMessage,
	scope whatsAppRuntimeFence,
	elapsed time.Duration,
	cause error,
) bool {
	if !scope.isValid() {
		return false
	}
	now := time.Now()
	m.mu.Lock()
	if m.inboundConnectionScope == nil ||
		!sameWhatsAppRuntimeFenceIdentity(*m.inboundConnectionScope, scope) {
		// A late callback from an already replaced runtime must not degrade or
		// reset its healthy successor.
		m.mu.Unlock()
		return false
	}
	if m.outboundStalledScope != nil &&
		sameWhatsAppRuntimeFenceIdentity(*m.outboundStalledScope, scope) {
		m.mu.Unlock()
		return false
	}
	// Linearize the irreversible process fence against provider admission
	// before releasing manager state. quarantineProviderClient repeats this
	// idempotently after the health state is visible.
	stalledClient := m.client
	m.markProviderClientStalled(stalledClient)
	captured := scope
	m.outboundStalledScope = &captured
	m.lastSendErrorAt = now
	m.consecutiveSendFailures++
	m.degradedReason = "outbound_send_stalled"
	m.mu.Unlock()

	log.Printf(
		"whatsmeow outbound provider call stalled worker_id=%s message_id_hash=%s runtime_generation=%d connection_epoch=%s elapsed_ms=%d error_code=%s",
		m.cfg.WorkerID,
		hashConnectionFlowIdentifier(data.MessageID),
		scope.RuntimeGeneration,
		scope.ConnectionEpoch,
		elapsed.Milliseconds(),
		safeOperationalErrorCode(cause),
	)
	m.quarantineProviderClient(
		stalledClient,
		"outbound_send",
		cause,
	)
	// The runtime is already synchronously fenced above. Recovery must not
	// extend the provider application's hard deadline if ResetConnection or an
	// observability dependency is itself unhealthy.
	go m.triggerConnectionResetWithForce(
		context.WithoutCancel(ctx),
		"outbound_send_stalled",
		cause,
		true,
	)
	return true
}

func outboundFailureOutcome(err error) string {
	if err == nil {
		return "failed"
	}
	text := strings.ToLower(err.Error())
	if strings.Contains(text, "timeout") || strings.Contains(text, "deadline exceeded") {
		return "timeout"
	}
	return "error"
}

func isOutboundReconnectCandidate(err error) bool {
	if err == nil {
		return false
	}
	text := strings.ToLower(err.Error())
	for _, token := range []string{
		"timeout",
		"deadline exceeded",
		"disconnected",
		"not connected",
		"stream",
		"websocket",
		"connection",
	} {
		if strings.Contains(text, token) {
			return true
		}
	}
	return false
}

func isOutboundStallFailure(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	text := strings.ToLower(err.Error())
	return strings.Contains(text, "timeout") ||
		strings.Contains(text, "timed out") ||
		strings.Contains(text, "deadline exceeded")
}

func outboundFailureResetReason(
	consecutiveFailures int,
	threshold int,
	err error,
) string {
	if isOutboundStallFailure(err) {
		return "outbound_send_stalled"
	}
	if consecutiveFailures >= normalizeOutboundFailureThreshold(threshold) &&
		isOutboundReconnectCandidate(err) {
		return "outbound_failure_threshold"
	}
	return ""
}

func (m *WhatsAppManager) recordKeepAliveTimeout(_ context.Context, event *events.KeepAliveTimeout) {
	if event == nil {
		return
	}
	now := time.Now()
	m.mu.Lock()
	m.keepAliveFailures = event.ErrorCount
	m.lastKeepAliveFailureAt = now
	if !event.LastSuccess.IsZero() &&
		(m.lastKeepAliveAt.IsZero() || event.LastSuccess.After(m.lastKeepAliveAt)) {
		m.lastKeepAliveAt = event.LastSuccess
	}
	m.mu.Unlock()

	lastSuccessAgeMS := int64(-1)
	if !event.LastSuccess.IsZero() {
		lastSuccessAgeMS = now.Sub(event.LastSuccess).Milliseconds()
		if lastSuccessAgeMS < 0 {
			lastSuccessAgeMS = 0
		}
	}
	logWhatsappSessionDebug(m.cfg.WhatsappSessionDebugEnabled, "keepalive.timeout_observed", map[string]any{
		"session_id":                 m.cfg.WorkerID,
		"provider":                   "whatsmeow",
		"runtime_generation":         m.cfg.RuntimeGeneration,
		"error_count":                event.ErrorCount,
		"last_success_age_ms":        lastSuccessAgeMS,
		"native_reconnect_budget_ms": whatsmeow.KeepAliveMaxFailTime.Milliseconds(),
		"manager_forced_reconnect":   false,
		"transport_authority":        "whatsmeow_time_budget",
	})
}

func (m *WhatsAppManager) recordKeepAliveRestored(_ context.Context) {
	now := time.Now()
	m.mu.Lock()
	previousFailures := m.keepAliveFailures
	m.keepAliveFailures = 0
	m.lastKeepAliveAt = now
	if m.degradedReason == "keepalive_timeout" {
		m.degradedReason = ""
	}
	m.mu.Unlock()
	logWhatsappSessionDebug(m.cfg.WhatsappSessionDebugEnabled, "keepalive.restored", map[string]any{
		"session_id":         m.cfg.WorkerID,
		"provider":           "whatsmeow",
		"runtime_generation": m.cfg.RuntimeGeneration,
		"previous_failures":  previousFailures,
	})
}

func (m *WhatsAppManager) triggerConnectionReset(ctx context.Context, reason string, cause error) bool {
	return m.triggerConnectionResetWithForce(ctx, reason, cause, false)
}

func (m *WhatsAppManager) triggerConnectionResetWithForce(
	ctx context.Context,
	reason string,
	cause error,
	force bool,
) bool {
	now := time.Now()
	m.mu.Lock()
	if !force &&
		!m.lastOutboundReconnectAt.IsZero() &&
		now.Sub(m.lastOutboundReconnectAt) < m.cfg.OutboundFailureReconnectCooldown {
		m.mu.Unlock()
		return false
	}
	m.lastOutboundReconnectAt = now
	m.degradedReason = reason
	m.status = "connecting"
	m.code = CodeAwaitConnection
	m.mu.Unlock()

	log.Printf("whatsmeow reconnect requested worker_id=%s reason=%s error_code=%s", m.cfg.WorkerID, reason, safeOperationalErrorCode(cause))
	if m.centrifugo != nil {
		m.publishState(context.Background(), "connecting", CodeAwaitConnection, WorkerStatusDisponible, "", "", false)
	}

	client := m.getClient()
	if client == nil {
		return false
	}
	if m.isProviderClientStalled(client) {
		// A context-ignoring SDK flight may still be mutating this exact
		// runtime. The application-level state/fence above asks the balancer to
		// replace it; ResetConnection/Disconnect here would overlap the old
		// flight and create a second destructive mutation on the same object.
		log.Printf(
			"whatsmeow provider runtime replacement required worker_id=%s reason=%s",
			m.cfg.WorkerID,
			reason,
		)
		return true
	}
	if client.IsConnected() {
		client.ResetConnection()
		return true
	}
	if client.Store != nil && client.Store.ID != nil {
		go func() {
			connectCtx, cancel := context.WithTimeout(context.Background(), m.cfg.WhatsAppConnectTimeout+5*time.Second)
			defer cancel()
			if err := m.connectClient(connectCtx, client, "outbound-watchdog"); err != nil {
				log.Printf("whatsmeow watchdog reconnect failed worker_id=%s error_code=%s", m.cfg.WorkerID, safeOperationalErrorCode(err))
			}
		}()
		return true
	}
	return false
}

func (m *WhatsAppManager) currentConnectionState() ConnectionState {
	m.mu.RLock()
	state := ConnectionState{
		Code:                    m.code,
		Status:                  m.status,
		WorkerID:                m.cfg.WorkerID,
		AccountID:               m.cfg.AccountID,
		WorkerTypeID:            WorkerTypeWhatsmeow,
		QRCode:                  m.currentQRCode,
		PairingCode:             m.currentPairingCode,
		PasskeyPublicKey:        m.currentPasskeyPublicKey,
		PasskeyPending:          m.currentPasskeyPublicKey != "",
		PasskeyConfirmationCode: m.currentPasskeyConfirmationCode,
		PasskeySkipHandoffUX:    m.currentPasskeySkipHandoffUX,
		ConnectionAttemptID:     m.connectionAttemptID,
		DebugTraceID:            m.debugTraceID,
		RuntimeGeneration:       m.cfg.RuntimeGeneration,
		WarmPoolID:              m.cfg.WarmPoolID,
		Time:                    time.Now().Unix(),
	}
	m.mu.RUnlock()
	if owned, ok := m.currentOwnedRuntimeConnectionFence(); ok &&
		state.ConnectionAttemptID == owned.ConnectionAttemptID {
		state.AuthorizedConnectionEpoch = owned.ConnectionEpoch
	}
	m.attachNativeConnectionStatus(&state)
	m.enrichReadiness(&state)
	return state
}

func healthBool(health map[string]any, key string) bool {
	value, _ := health[key].(bool)
	return value
}

func healthString(health map[string]any, key string) string {
	value, _ := health[key].(string)
	return value
}

func healthInt(health map[string]any, key string) int {
	switch value := health[key].(type) {
	case int:
		return value
	case int32:
		return int(value)
	case int64:
		return int(value)
	case float64:
		return int(value)
	default:
		return 0
	}
}

func (m *WhatsAppManager) enrichReadiness(state *ConnectionState) {
	if state == nil {
		return
	}

	health := m.ConnectionHealth()
	consumerBarrierReady := m.isConsumerBarrierReady()
	state.SessionReady = healthBool(health, "session_ready") && consumerBarrierReady
	state.CanSend = healthBool(health, "can_send") && consumerBarrierReady
	state.CanReceiveRuntime = healthBool(health, "can_receive_runtime") && consumerBarrierReady
	state.Authenticated = healthBool(health, "authenticated")
	state.ProviderState = healthString(health, "provider_state")
	state.DegradedReason = healthString(health, "degraded_reason")
	state.LastProbeAt = healthString(health, "last_probe_at")
	state.ProbeLatencyMS = healthInt(health, "probe_latency_ms")

	if state.WorkerStatusID == WorkerStatusOnline && !state.SessionReady {
		downgradeReason := "session_not_ready"
		if !consumerBarrierReady {
			downgradeReason = "command_ingress_positioning"
		}
		if state.DegradedReason == "" {
			state.DegradedReason = downgradeReason
		}
		localConnectionStatusLog("whatsmeow.readiness.online_downgraded", map[string]any{
			"layer":                 "worker_whatsmeow.readiness",
			"provider":              "whatsmeow",
			"worker_id":             state.WorkerID,
			"account_id":            state.AccountID,
			"worker_type_id":        state.WorkerTypeID,
			"worker_status_id":      state.WorkerStatusID,
			"status":                state.Status,
			"code":                  state.Code,
			"session_ready":         state.SessionReady,
			"can_send":              state.CanSend,
			"can_receive_runtime":   state.CanReceiveRuntime,
			"authenticated":         state.Authenticated,
			"provider_state":        state.ProviderState,
			"degraded_reason":       state.DegradedReason,
			"reason":                firstNonEmpty(state.Reason, downgradeReason),
			"phone":                 state.Phone,
			"connection_attempt_id": state.ConnectionAttemptID,
			"runtime_generation":    state.RuntimeGeneration,
		})
		state.WorkerStatusID = WorkerStatusDisponible
		state.Status = "connecting"
		if state.Code == CodeConnectionEstablished {
			state.Code = CodeAwaitConnection
		}
		if state.Reason == "" {
			state.Reason = downgradeReason
		}
	}
}

func (m *WhatsAppManager) waitForSessionReady(ctx context.Context, reason string) map[string]any {
	return m.waitForSessionReadyWhile(ctx, reason, nil)
}

func (m *WhatsAppManager) waitForSessionReadyForScope(
	ctx context.Context,
	reason string,
	scope whatsAppRuntimeFence,
) map[string]any {
	return m.waitForSessionReadyWhile(ctx, reason, func() bool {
		current, ok := m.currentInboundConnectionScope()
		return ok && sameWhatsAppRuntimeFenceIdentity(current, scope)
	})
}

func (m *WhatsAppManager) waitForSessionReadyWhile(
	ctx context.Context,
	reason string,
	stillCurrent func() bool,
) map[string]any {
	deadline := time.NewTimer(whatsmeowSessionReadyTimeout)
	ticker := time.NewTicker(whatsmeowSessionReadyPollInterval)
	defer deadline.Stop()
	defer ticker.Stop()

	var health map[string]any
	for {
		if stillCurrent != nil && !stillCurrent() {
			health = m.ConnectionHealth()
			health["provider_state"] = "runtime_fence_revoked"
			health["degraded_reason"] = "runtime_fence_revoked"
			return health
		}

		health = m.ConnectionHealth()
		if healthBool(health, "session_ready") {
			return health
		}

		select {
		case <-ctx.Done():
			return health
		case <-deadline.C:
			log.Printf(
				"whatsmeow session readiness timeout worker_id=%s reason=%s provider_state=%s degraded_reason=%s authenticated=%t client_connected=%t logged_in=%t has_store_id=%t connected_event=%t",
				m.cfg.WorkerID,
				reason,
				healthString(health, "provider_state"),
				healthString(health, "degraded_reason"),
				healthBool(health, "authenticated"),
				healthBool(health, "client_connected"),
				healthBool(health, "logged_in"),
				healthBool(health, "has_store_id"),
				healthBool(health, "connected_event"),
			)
			return health
		case <-ticker.C:
		}
	}
}

func (m *WhatsAppManager) isTerminalSessionInvalidated() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()

	return m.status == "disconnected" &&
		(m.code == CodeLoggedOut || m.code == CodeConnectionReplaced || m.degradedReason == "logged_out" || m.degradedReason == "stream_replaced")
}

func (m *WhatsAppManager) setConsumerBarrierCallbacks(check func() bool, invalidate func()) {
	m.mu.Lock()
	m.consumerBarrierReady = check
	m.consumerBarrierInvalidate = invalidate
	m.mu.Unlock()
}

func (m *WhatsAppManager) isConsumerBarrierReady() bool {
	m.mu.RLock()
	check := m.consumerBarrierReady
	m.mu.RUnlock()
	return check != nil && check()
}

func (m *WhatsAppManager) invalidateConsumerBarrier() {
	m.mu.RLock()
	invalidate := m.consumerBarrierInvalidate
	m.mu.RUnlock()
	if invalidate != nil {
		invalidate()
	}
}

func (m *WhatsAppManager) isVerifiedCurrentProviderConnection(client *whatsmeow.Client) bool {
	return !m.isProviderProcessQuarantined() &&
		client != nil &&
		m.getClient() == client &&
		client.Store != nil &&
		client.Store.ID != nil &&
		phoneFromOwnID(client.Store.ID) != "" &&
		client.IsConnected() &&
		client.IsLoggedIn()
}

func (m *WhatsAppManager) activateVerifiedInboundConnectionScope(
	ctx context.Context,
	client *whatsmeow.Client,
	reason string,
) (whatsAppRuntimeFence, error) {
	if m.isProviderProcessQuarantined() {
		return whatsAppRuntimeFence{}, fmt.Errorf(
			"%w: provider process is quarantined; restart is required before %s",
			errWhatsmeowProviderClientFenced,
			reason,
		)
	}
	activationCtx, cancel := m.runtimeFenceActivationContext(ctx)
	defer cancel()

	if !m.isVerifiedCurrentProviderConnection(client) {
		return whatsAppRuntimeFence{}, fmt.Errorf(
			"%w: provider connection is not ready for %s",
			errWhatsAppRuntimeFenceRevoked,
			reason,
		)
	}

	if current, err := m.captureActiveConnectionScope(activationCtx); err == nil {
		return current, nil
	}

	return m.rotateVerifiedInboundConnectionScope(
		activationCtx,
		client,
		reason,
	)
}

func (m *WhatsAppManager) cancelRuntimeFenceRecovery() {
	m.runtimeFenceRecoveryMu.Lock()
	m.runtimeFenceRecoverySerial++
	cancel := m.runtimeFenceRecoveryCancel
	m.runtimeFenceRecoveryCancel = nil
	m.runtimeFenceRecoveryClient = nil
	m.runtimeFenceRecoveryMu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func (m *WhatsAppManager) isRuntimeFenceRecoveryProviderCurrent(
	client *whatsmeow.Client,
) bool {
	if m.isProviderProcessQuarantined() {
		return false
	}
	if m.runtimeFenceRecoveryVerify != nil {
		return m.runtimeFenceRecoveryVerify(client)
	}
	return m.isVerifiedCurrentProviderConnection(client)
}

func (m *WhatsAppManager) rotateRuntimeFenceRecoveryScope(
	ctx context.Context,
	client *whatsmeow.Client,
	reason string,
) (whatsAppRuntimeFence, error) {
	if m.isProviderProcessQuarantined() {
		return whatsAppRuntimeFence{}, fmt.Errorf(
			"%w: provider process is quarantined; restart is required before runtime recovery",
			errWhatsmeowProviderClientFenced,
		)
	}
	if m.runtimeFenceRecoveryRotate != nil {
		return m.runtimeFenceRecoveryRotate(ctx, client, reason)
	}
	return m.rotateVerifiedInboundConnectionScope(ctx, client, reason)
}

func (m *WhatsAppManager) isRuntimeFenceRecoveryCurrent(
	ctx context.Context,
	client *whatsmeow.Client,
	recoverySerial uint64,
	lifecycleSerial uint64,
) bool {
	if ctx == nil || ctx.Err() != nil || client == nil || lifecycleSerial == 0 {
		return false
	}
	m.runtimeFenceRecoveryMu.Lock()
	current := m.runtimeFenceRecoverySerial == recoverySerial &&
		m.runtimeFenceRecoveryCancel != nil &&
		m.runtimeFenceRecoveryClient == client
	m.runtimeFenceRecoveryMu.Unlock()
	return current &&
		m.isProviderLifecycleEventCurrent(lifecycleSerial) &&
		m.isRuntimeFenceRecoveryProviderCurrent(client)
}

func (m *WhatsAppManager) applyRuntimeFenceRecoveryState(
	ctx context.Context,
	client *whatsmeow.Client,
	scope whatsAppRuntimeFence,
	recoverySerial uint64,
	lifecycleSerial uint64,
) bool {
	if ctx == nil || client == nil || !scope.isValid() {
		return false
	}
	if m.isProviderProcessQuarantined() {
		return false
	}

	// Lock order is recovery -> manager state. Cancellation uses only the
	// recovery lock, while lifecycle creation uses lifecycle -> recovery ->
	// manager state. A logout/reset therefore either wins before this check or
	// waits and deterministically overwrites the recovered state afterwards.
	m.runtimeFenceRecoveryMu.Lock()
	defer m.runtimeFenceRecoveryMu.Unlock()
	if ctx.Err() != nil ||
		m.runtimeFenceRecoverySerial != recoverySerial ||
		m.runtimeFenceRecoveryCancel == nil ||
		m.runtimeFenceRecoveryClient != client ||
		!m.isRuntimeFenceRecoveryProviderCurrent(client) {
		return false
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	if lifecycleSerial == 0 ||
		lifecycleSerial != m.providerLifecycleEventSerial ||
		m.client != client ||
		m.inboundConnectionScope == nil ||
		!sameWhatsAppRuntimeFenceIdentity(*m.inboundConnectionScope, scope) {
		return false
	}
	m.connected = true
	m.status = "connected"
	m.code = CodeConnectionEstablished
	m.lastKeepAliveAt = time.Now()
	m.keepAliveFailures = 0
	m.consecutiveSendFailures = 0
	m.degradedReason = ""
	return true
}

func (m *WhatsAppManager) runRuntimeFenceRecovery(
	recoveryCtx context.Context,
	cancel context.CancelFunc,
	client *whatsmeow.Client,
	reason string,
	recoverySerial uint64,
	lifecycleSerial uint64,
) {
	defer func() {
		cancel()
		m.runtimeFenceRecoveryMu.Lock()
		if m.runtimeFenceRecoverySerial == recoverySerial {
			m.runtimeFenceRecoveryCancel = nil
			m.runtimeFenceRecoveryClient = nil
		}
		m.runtimeFenceRecoveryMu.Unlock()
	}()

	if !m.isRuntimeFenceRecoveryCurrent(
		recoveryCtx,
		client,
		recoverySerial,
		lifecycleSerial,
	) {
		return
	}
	scope, err := m.rotateRuntimeFenceRecoveryScope(
		recoveryCtx,
		client,
		reason+"-balance-recovery",
	)
	if err != nil {
		if recoveryCtx.Err() == nil &&
			m.isProviderLifecycleEventCurrent(lifecycleSerial) {
			log.Printf(
				"whatsmeow runtime fence recovery stopped worker_id=%s generation=%d reason=%s error_code=%s",
				m.cfg.WorkerID,
				m.cfg.RuntimeGeneration,
				reason,
				safeOperationalErrorCode(err),
			)
		}
		return
	}

	if m.runtimeFenceRecoveryBeforeApply != nil {
		m.runtimeFenceRecoveryBeforeApply()
	}
	if !m.applyRuntimeFenceRecoveryState(
		recoveryCtx,
		client,
		scope,
		recoverySerial,
		lifecycleSerial,
	) {
		m.deactivateCapturedInboundConnectionScopeAsync(&scope)
		return
	}

	log.Printf(
		"whatsmeow runtime fence recovered in place worker_id=%s generation=%d reason=%s connection_epoch=%s",
		m.cfg.WorkerID,
		m.cfg.RuntimeGeneration,
		reason,
		scope.ConnectionEpoch,
	)
}

// scheduleRuntimeFenceRecovery retains a physically authenticated provider
// socket while Balance is unavailable and retries the exact durable runtime
// activation in place. rotateVerifiedInboundConnectionScope owns one
// connection epoch for the whole retry, so a prolonged outage cannot churn
// epochs or overlap Kafka consumers. Disconnect/replacement events cancel this
// flight synchronously through beginFencedProviderLifecycleEvent.
func (m *WhatsAppManager) scheduleRuntimeFenceRecovery(
	client *whatsmeow.Client,
	reason string,
	lifecycleSerial uint64,
) {
	if client == nil ||
		lifecycleSerial == 0 ||
		m.isProviderProcessQuarantined() {
		return
	}

	// Serialize registration with lifecycle advancement. A terminal event can
	// no longer cancel an empty slot and then have a stale handler register a
	// new recovery flight in the gap before the lifecycle serial advances.
	m.lifecycleMu.Lock()
	defer m.lifecycleMu.Unlock()
	if !m.isProviderLifecycleEventCurrent(lifecycleSerial) ||
		!m.isRuntimeFenceRecoveryProviderCurrent(client) {
		return
	}

	m.runtimeFenceRecoveryMu.Lock()
	if m.runtimeFenceRecoveryCancel != nil &&
		m.runtimeFenceRecoveryClient == client {
		m.runtimeFenceRecoveryMu.Unlock()
		return
	}
	if m.runtimeFenceRecoveryCancel != nil {
		m.runtimeFenceRecoveryCancel()
	}
	recoveryCtx, cancel := context.WithCancel(m.connectionContext())
	m.runtimeFenceRecoverySerial++
	recoverySerial := m.runtimeFenceRecoverySerial
	m.runtimeFenceRecoveryCancel = cancel
	m.runtimeFenceRecoveryClient = client
	m.runtimeFenceRecoveryMu.Unlock()

	go m.runRuntimeFenceRecovery(
		recoveryCtx,
		cancel,
		client,
		reason,
		recoverySerial,
		lifecycleSerial,
	)
}

func (m *WhatsAppManager) runtimeFenceActivationContext(
	ctx context.Context,
) (context.Context, context.CancelFunc) {
	timeout := m.cfg.WhatsAppConnectTimeout
	if timeout <= 0 {
		timeout = 45 * time.Second
	}
	if ctx == nil {
		ctx = context.Background()
	}
	return context.WithTimeout(ctx, timeout)
}

func (m *WhatsAppManager) rotateVerifiedInboundConnectionScope(
	ctx context.Context,
	client *whatsmeow.Client,
	reason string,
) (whatsAppRuntimeFence, error) {
	if m.isProviderProcessQuarantined() {
		return whatsAppRuntimeFence{}, fmt.Errorf(
			"%w: provider process is quarantined; restart is required before %s",
			errWhatsmeowProviderClientFenced,
			reason,
		)
	}
	if !m.isVerifiedCurrentProviderConnection(client) {
		return whatsAppRuntimeFence{}, fmt.Errorf(
			"%w: provider connection is not ready for %s",
			errWhatsAppRuntimeFenceRevoked,
			reason,
		)
	}

	scope, err := m.replaceInboundConnectionScope(ctx)
	if err != nil {
		return whatsAppRuntimeFence{}, err
	}
	if !m.isVerifiedCurrentProviderConnection(client) {
		m.deactivateCapturedInboundConnectionScopeAsync(&scope)
		return whatsAppRuntimeFence{}, fmt.Errorf(
			"%w: provider connection changed while activating %s",
			errWhatsAppRuntimeFenceRevoked,
			reason,
		)
	}
	return scope, nil
}

func (m *WhatsAppManager) rotateVerifiedInboundConnectionScopeWithTimeout(
	ctx context.Context,
	client *whatsmeow.Client,
	reason string,
) (whatsAppRuntimeFence, error) {
	activationCtx, cancel := m.runtimeFenceActivationContext(ctx)
	defer cancel()
	return m.rotateVerifiedInboundConnectionScope(activationCtx, client, reason)
}

func (m *WhatsAppManager) publishConnectedWhenReady(ctx context.Context, reason string, phone string, isNewLogin bool) bool {
	scope, err := m.captureActiveConnectionScope(ctx)
	if err != nil {
		log.Printf(
			"whatsmeow connected publish skipped without active runtime fence worker_id=%s generation=%d reason=%s error_code=%s",
			m.cfg.WorkerID,
			m.cfg.RuntimeGeneration,
			reason,
			safeOperationalErrorCode(err),
		)
		return false
	}
	return m.publishConnectedWhenReadyForScope(ctx, scope, reason, phone, isNewLogin)
}

func (m *WhatsAppManager) publishConnectedWhenReadyForScope(
	ctx context.Context,
	scope whatsAppRuntimeFence,
	reason string,
	phone string,
	isNewLogin bool,
) bool {
	health := m.waitForSessionReadyForScope(ctx, reason, scope)
	return m.publishConnectedWithHealth(ctx, health, scope, reason, phone, isNewLogin)
}

// publishConnectedAfterConsumerBarrier performs a non-blocking provider
// recheck. The consumer supervisor must remain responsive to a disconnect so it
// can close and recreate every reader at the new end offset.
func (m *WhatsAppManager) publishConnectedAfterConsumerBarrier(ctx context.Context, reason string) bool {
	scope, err := m.captureActiveConnectionScope(ctx)
	if err != nil {
		return false
	}
	return m.publishConnectedAfterConsumerBarrierForScope(ctx, scope, reason)
}

func (m *WhatsAppManager) publishConnectedAfterConsumerBarrierForScope(
	ctx context.Context,
	scope whatsAppRuntimeFence,
	reason string,
) bool {
	// Never let a replacement connection satisfy the barrier opened by the
	// previous connection's Kafka consumer set.
	if err := m.assertCapturedConnectionScope(ctx, scope); err != nil {
		return false
	}
	return m.publishConnectedWithHealth(ctx, m.ConnectionHealth(), scope, reason, "", false)
}

func (m *WhatsAppManager) publishConnectedWithHealth(
	ctx context.Context,
	health map[string]any,
	scope whatsAppRuntimeFence,
	reason string,
	phone string,
	isNewLogin bool,
) bool {
	if m.sourceProviderHandoffInProgress.Load() {
		logWhatsappSessionDebug(m.cfg.WhatsappSessionDebugEnabled, "provider_handoff.source_online_publish_fenced", map[string]any{
			"trace_id": m.getDebugTraceID(), "session_id": m.cfg.WorkerID,
			"provider": "whatsmeow", "runtime_generation": m.cfg.RuntimeGeneration,
			"reason": reason,
		})
		return false
	}
	if m.isProviderProcessQuarantined() {
		log.Printf(
			"whatsmeow connected publish rejected for quarantined process worker_id=%s reason=%s",
			m.cfg.WorkerID,
			reason,
		)
		return false
	}
	if m.isTerminalSessionInvalidated() {
		log.Printf("whatsmeow connected publish skipped after terminal session invalidation worker_id=%s reason=%s", m.cfg.WorkerID, reason)
		return false
	}

	fencedCtx := withInboundConnectionScope(ctx, scope)
	if !healthBool(health, "session_ready") {
		if err := m.assertCapturedConnectionScope(fencedCtx, scope); err != nil {
			return false
		}
		if m.providerHandoffInProgress.Load() {
			if m.providerHandoffSnapshotResyncPending.Load() {
				logWhatsappSessionDebug(
					m.cfg.WhatsappSessionDebugEnabled,
					"handoff_app_state_snapshot_resync_publish_deferred",
					map[string]any{
						"session_id": m.cfg.WorkerID,
						"provider":   "whatsmeow",
						"stage":      "validating",
					},
				)
				return false
			}
			if err := m.rollbackActiveProviderHandoff(fencedCtx, "readiness_validation_failed"); err != nil {
				log.Printf(
					"whatsapp provider handoff readiness rollback failed worker_id=%s error_code=%s",
					m.cfg.WorkerID, safeOperationalErrorCode(err),
				)
			}
			return false
		}
		m.publishState(fencedCtx, "connecting", CodeAwaitConnection, WorkerStatusDisponible, phone, "", isNewLogin)
		return false
	}
	if !m.isConsumerBarrierReady() {
		if err := m.assertCapturedConnectionScope(fencedCtx, scope); err != nil {
			return false
		}
		// The provider session is authenticated and its durable runtime fence is
		// active. Kafka is intentionally fail-closed while the new assignments
		// seek to the end, but that transient positioning window is not evidence
		// that the WhatsApp session became unavailable. Publishing "disponible"
		// here used to overwrite ONLINE (or RECREATING) for the whole rebalance
		// window, even though the same session became ready a few seconds later.
		//
		// Keep the central status unchanged until either all consumers are ready
		// (the supervisor publishes ONLINE) or a real provider/fence failure is
		// observed (the normal unavailable paths publish their terminal state).
		localConnectionStatusLog("whatsmeow.connected.kafka_barrier_pending", map[string]any{
			"layer":                 "worker_whatsmeow.readiness",
			"provider":              "whatsmeow",
			"worker_id":             m.cfg.WorkerID,
			"account_id":            m.cfg.AccountID,
			"worker_type_id":        WorkerTypeWhatsmeow,
			"session_ready":         false,
			"can_send":              false,
			"can_receive_runtime":   false,
			"authenticated":         healthBool(health, "authenticated"),
			"provider_state":        healthString(health, "provider_state"),
			"degraded_reason":       "command_ingress_positioning",
			"reason":                reason,
			"phone":                 phone,
			"connection_attempt_id": m.getConnectionAttemptID(),
			"runtime_generation":    m.cfg.RuntimeGeneration,
			"connection_epoch":      scope.ConnectionEpoch,
		})
		log.Printf("whatsmeow connected publish deferred without central downgrade worker_id=%s reason=%s kafka_consumers_ready=false", m.cfg.WorkerID, reason)
		return false
	}

	if err := m.assertCapturedConnectionScope(fencedCtx, scope); err != nil {
		log.Printf(
			"whatsmeow connected publish blocked by runtime fence worker_id=%s generation=%d reason=%s error_code=%s",
			m.cfg.WorkerID,
			m.cfg.RuntimeGeneration,
			reason,
			safeOperationalErrorCode(err),
		)
		return false
	}

	// The readiness sample may have been collected by an older goroutine.
	// Re-read the provider state only after the captured epoch is proven active.
	// This prevents Connected -> Disconnected -> delayed readiness completion
	// from publishing online or creating any replacement epoch.
	currentHealth := m.ConnectionHealth()
	if !healthBool(currentHealth, "session_ready") ||
		!m.isConsumerBarrierReady() {
		return false
	}
	if err := m.assertCapturedConnectionScope(fencedCtx, scope); err != nil {
		return false
	}

	localConnectionStatusLog("whatsmeow.connected.readiness_result", map[string]any{
		"layer":                 "worker_whatsmeow.readiness",
		"provider":              "whatsmeow",
		"worker_id":             m.cfg.WorkerID,
		"account_id":            m.cfg.AccountID,
		"worker_type_id":        WorkerTypeWhatsmeow,
		"session_ready":         healthBool(health, "session_ready"),
		"can_send":              healthBool(health, "can_send"),
		"can_receive_runtime":   healthBool(health, "can_receive_runtime"),
		"authenticated":         healthBool(health, "authenticated"),
		"provider_state":        healthString(health, "provider_state"),
		"degraded_reason":       healthString(health, "degraded_reason"),
		"reason":                reason,
		"phone":                 phone,
		"connection_attempt_id": m.getConnectionAttemptID(),
		"runtime_generation":    m.cfg.RuntimeGeneration,
		"connection_epoch":      scope.ConnectionEpoch,
	})

	if phone == "" {
		if client := m.getClient(); client != nil && client.Store != nil && client.Store.ID != nil {
			phone = phoneFromOwnID(client.Store.ID)
		}
	}
	if m.cfg.SessionStorage == SessionStoragePostgres {
		persistCtx, cancel := context.WithTimeout(fencedCtx, workerDatabasePingTimeout)
		err := m.postgres.MarkWhatsmeowSessionReady(persistCtx, m.cfg)
		cancel()
		if err != nil {
			localConnectionStatusLog("whatsmeow.connected.session_checkpoint.error", map[string]any{
				"layer":               "worker_whatsmeow.session",
				"provider":            "whatsmeow",
				"worker_id":           m.cfg.WorkerID,
				"account_id":          m.cfg.AccountID,
				"worker_type_id":      WorkerTypeWhatsmeow,
				"runtime_generation":  m.cfg.RuntimeGeneration,
				"connection_epoch":    scope.ConnectionEpoch,
				"connection_sequence": scope.ConnectionSequence,
				"session_storage":     SessionStoragePostgres,
				"reason":              safeOperationalErrorCode(err),
			})
			log.Printf("whatsmeow postgres session checkpoint failed worker_id=%s error_code=%s", m.cfg.WorkerID, safeOperationalErrorCode(err))
			if m.providerHandoffInProgress.Load() {
				if rollbackErr := m.rollbackActiveProviderHandoff(
					context.WithoutCancel(fencedCtx),
					"atomic_promotion_validation_failed",
				); rollbackErr != nil {
					log.Printf(
						"whatsapp provider handoff atomic promotion rollback failed worker_id=%s error_code=%s",
						m.cfg.WorkerID,
						safeOperationalErrorCode(rollbackErr),
					)
				}
			}
			return false
		}
		if m.providerHandoffInProgress.Load() {
			m.providerHandoffStage.Store(nil)
			m.providerHandoffInProgress.Store(false)
			m.providerHandoffSnapshotResyncPending.Store(false)
			m.publishCurrentNativeConnectionStatusAfterResync()
		}
	}

	log.Printf("whatsmeow session readiness confirmed worker_id=%s reason=%s phone_set=%t", m.cfg.WorkerID, reason, phone != "")
	go m.markPresenceAvailable(withInboundConnectionScope(context.Background(), scope), reason)
	return m.publishState(fencedCtx, "connected", CodeConnectionEstablished, WorkerStatusOnline, phone, "", isNewLogin)
}

func (m *WhatsAppManager) RequestConnection(ctx context.Context, req StatusConnectionRequest) (state ConnectionState, err error) {
	m.connectionRequestMu.Lock()
	defer m.connectionRequestMu.Unlock()

	if m.sourceProviderHandoffInProgress.Load() {
		return ConnectionState{}, errors.New("whatsmeow provider handoff has fenced reconnect")
	}
	connectionType := strings.ToLower(strings.TrimSpace(req.Type))
	authorizedFence, authorizationErr := normalizeAuthorizedRuntimeConnectionFence(
		req.ConnectionAttemptID,
		req.AuthorizedConnectionEpoch,
	)
	if authorizationErr != nil {
		return ConnectionState{}, authorizationErr
	}
	if authorizedFence != nil {
		defer func() {
			state.AuthorizedConnectionEpoch = authorizedFence.ConnectionEpoch
		}()
		if req.WorkerID != "" && req.WorkerID != m.cfg.WorkerID {
			return ConnectionState{}, fmt.Errorf("request worker_id %s does not match %s", req.WorkerID, m.cfg.WorkerID)
		}
		if req.RuntimeGeneration > 0 && req.RuntimeGeneration != m.cfg.RuntimeGeneration {
			return ConnectionState{}, fmt.Errorf(
				"authorized QR reconnect runtime_generation %d does not match %d",
				req.RuntimeGeneration,
				m.cfg.RuntimeGeneration,
			)
		}
		if connectionType != "" && connectionType != "qrcode" {
			return ConnectionState{}, errors.New("authorized connection epoch is valid only for qrcode")
		}
		if req.RemoveSession || req.Status == WorkerStatusDisponible {
			return ConnectionState{}, errors.New("authorized connection epoch cannot be used while removing a session")
		}
		if m.isProviderProcessQuarantined() {
			return ConnectionState{}, fmt.Errorf(
				"%w: provider process is quarantined; restart is required before RequestConnection",
				errWhatsmeowProviderClientFenced,
			)
		}
		activationCtx, cancel := m.runtimeFenceActivationContext(ctx)
		_, activationErr := m.preactivateAuthorizedRuntimeConnectionFence(
			activationCtx,
			authorizedFence.ConnectionAttemptID,
			authorizedFence.ConnectionEpoch,
		)
		cancel()
		if activationErr != nil {
			return ConnectionState{}, fmt.Errorf(
				"preactivate authorized WhatsApp runtime connection fence: %w",
				activationErr,
			)
		}
	}
	startedAt := time.Now()
	if req.ConnectionAttemptID != "" {
		m.setConnectionAttemptID(req.ConnectionAttemptID)
		defer func() {
			if state.ConnectionAttemptID == "" {
				state.ConnectionAttemptID = req.ConnectionAttemptID
			}
		}()
	}
	if req.DebugTraceID != "" {
		m.setDebugTraceID(req.DebugTraceID)
		defer func() {
			if state.DebugTraceID == "" {
				state.DebugTraceID = req.DebugTraceID
			}
		}()
	}
	m.debug.Log(ctx, "whatsmeow.provider.request_connection.received", map[string]any{
		"trace_id":                        req.DebugTraceID,
		"layer":                           "worker_whatsmeow.provider",
		"worker_id":                       firstNonEmpty(req.WorkerID, m.cfg.WorkerID),
		"account_id":                      m.cfg.AccountID,
		"worker_type_id":                  WorkerTypeWhatsmeow,
		"connection_attempt_id":           req.ConnectionAttemptID,
		"authorized_connection_epoch_set": req.AuthorizedConnectionEpoch != "",
		"runtime_generation":              req.RuntimeGeneration,
		"status":                          req.Status,
		"type":                            req.Type,
		"remove_session":                  req.RemoveSession,
		"qr_pending":                      req.QRPending,
		"phone_connection_set":            req.PhoneConnection != "",
	})
	defer func() {
		fields := map[string]any{
			"trace_id":              firstNonEmpty(state.DebugTraceID, req.DebugTraceID),
			"layer":                 "worker_whatsmeow.provider",
			"worker_id":             firstNonEmpty(state.WorkerID, req.WorkerID, m.cfg.WorkerID),
			"account_id":            firstNonEmpty(state.AccountID, m.cfg.AccountID),
			"worker_type_id":        WorkerTypeWhatsmeow,
			"connection_attempt_id": firstNonEmpty(state.ConnectionAttemptID, req.ConnectionAttemptID),
			"runtime_generation":    firstNonZero(state.RuntimeGeneration, req.RuntimeGeneration),
			"status":                state.Status,
			"code":                  state.Code,
			"duration_ms":           time.Since(startedAt).Milliseconds(),
			"has_qr":                state.QRCode != "",
			"qr_length":             len(state.QRCode),
			"has_pairing_code":      state.PairingCode != "",
			"pairing_code_length":   len(state.PairingCode),
		}
		if err != nil {
			fields["error_code"] = safeOperationalErrorCode(err)
			m.debug.Log(ctx, "whatsmeow.provider.request_connection.error", fields)
			return
		}
		m.debug.Log(ctx, "whatsmeow.provider.request_connection.response", fields)
	}()

	log.Printf(
		"whatsmeow RequestConnection worker_id=%s status=%s type=%s remove_session=%t qr_pending=%t phone_connection_set=%t",
		req.WorkerID,
		req.Status,
		req.Type,
		req.RemoveSession,
		req.QRPending,
		req.PhoneConnection != "",
	)
	connectionFlowLog("whatsmeow.provider.request_connection.received", map[string]any{
		"trace_id":              req.DebugTraceID,
		"layer":                 "worker_whatsmeow.provider",
		"worker_id":             firstNonEmpty(req.WorkerID, m.cfg.WorkerID),
		"account_id":            m.cfg.AccountID,
		"worker_type_id":        WorkerTypeWhatsmeow,
		"connection_attempt_id": req.ConnectionAttemptID,
		"runtime_generation":    req.RuntimeGeneration,
		"status":                req.Status,
		"type":                  req.Type,
		"remove_session":        req.RemoveSession,
		"qr_pending":            req.QRPending,
		"phone_connection_set":  req.PhoneConnection != "",
	})
	if req.WorkerID != "" && req.WorkerID != m.cfg.WorkerID {
		return ConnectionState{}, fmt.Errorf("request worker_id %s does not match %s", req.WorkerID, m.cfg.WorkerID)
	}
	if m.isProviderProcessQuarantined() {
		return ConnectionState{}, fmt.Errorf(
			"%w: provider process is quarantined; restart is required before RequestConnection",
			errWhatsmeowProviderClientFenced,
		)
	}

	if connectionType == "phone" {
		return ConnectionState{}, fmt.Errorf("phone connection is disabled; use qrcode")
	}

	if req.RemoveSession || req.Status == WorkerStatusDisponible {
		m.debug.Log(ctx, "whatsmeow.provider.remove_session.start", map[string]any{
			"trace_id":              req.DebugTraceID,
			"layer":                 "worker_whatsmeow.provider",
			"worker_id":             m.cfg.WorkerID,
			"account_id":            m.cfg.AccountID,
			"worker_type_id":        WorkerTypeWhatsmeow,
			"connection_attempt_id": req.ConnectionAttemptID,
			"runtime_generation":    req.RuntimeGeneration,
		})
		if err := m.removeSession(ctx); err != nil {
			return ConnectionState{}, err
		}
		state = ConnectionState{
			Code:              CodeConnectionClosed,
			Status:            "disconnected",
			WorkerID:          m.cfg.WorkerID,
			AccountID:         m.cfg.AccountID,
			WorkerTypeID:      WorkerTypeWhatsmeow,
			DisconnectedUser:  true,
			Time:              time.Now().Unix(),
			WorkerStatusID:    WorkerStatusDisponible,
			DebugTraceID:      req.DebugTraceID,
			RuntimeGeneration: req.RuntimeGeneration,
			WarmPoolID:        req.WarmPoolID,
		}
		return state, nil
	}

	if m.publishConnectedIfAuthenticated(ctx, "request-connection-already-authenticated") {
		return m.currentConnectionState(), nil
	}

	switch connectionType {
	case "qrcode", "":
		return m.connectWithQRCode(ctx)
	default:
		return ConnectionState{}, fmt.Errorf("unsupported connection type %q", req.Type)
	}
}

func (m *WhatsAppManager) validatePasskeyRequest(reqWorkerID, reqAccountID, reqAttemptID string) error {
	if reqWorkerID != "" && reqWorkerID != m.cfg.WorkerID {
		return fmt.Errorf("request worker_id %s does not match %s", reqWorkerID, m.cfg.WorkerID)
	}
	if reqAccountID != "" && reqAccountID != m.cfg.AccountID {
		return fmt.Errorf("request account_id %s does not match %s", reqAccountID, m.cfg.AccountID)
	}
	currentAttemptID := m.getConnectionAttemptID()
	if reqAttemptID != "" && currentAttemptID != "" && reqAttemptID != currentAttemptID {
		return fmt.Errorf("connection attempt %s does not match active attempt %s", reqAttemptID, currentAttemptID)
	}
	return nil
}

func (m *WhatsAppManager) ImportSecureSession(ctx context.Context, req SecureSessionImportRequest) (ConnectionState, error) {
	return m.importSecureSessionPackage(ctx, req)
}

func (m *WhatsAppManager) SendPasskeyResponse(ctx context.Context, req PasskeyResponseRequest) (ConnectionState, error) {
	if req.DebugTraceID != "" {
		m.setDebugTraceID(req.DebugTraceID)
	}
	currentState := m.currentConnectionState()
	connectionFlowLog("whatsmeow.provider.passkey_response.received", map[string]any{
		"trace_id":              req.DebugTraceID,
		"layer":                 "worker_whatsmeow.provider",
		"worker_id":             firstNonEmpty(req.WorkerID, m.cfg.WorkerID),
		"account_id":            firstNonEmpty(req.AccountID, m.cfg.AccountID),
		"worker_type_id":        WorkerTypeWhatsmeow,
		"connection_attempt_id": req.ConnectionAttemptID,
		"active_attempt_id":     m.getConnectionAttemptID(),
		"status":                currentState.Status,
		"code":                  currentState.Code,
		"has_passkey_response":  req.PasskeyResponse != "",
		"passkey_response_len":  len(req.PasskeyResponse),
	})
	if err := m.validatePasskeyRequest(req.WorkerID, req.AccountID, req.ConnectionAttemptID); err != nil {
		connectionFlowLog("whatsmeow.provider.passkey_response.invalid_context", map[string]any{
			"trace_id":              req.DebugTraceID,
			"layer":                 "worker_whatsmeow.provider",
			"worker_id":             firstNonEmpty(req.WorkerID, m.cfg.WorkerID),
			"account_id":            firstNonEmpty(req.AccountID, m.cfg.AccountID),
			"worker_type_id":        WorkerTypeWhatsmeow,
			"connection_attempt_id": req.ConnectionAttemptID,
			"active_attempt_id":     m.getConnectionAttemptID(),
			"reason":                safeOperationalErrorCode(err),
		})
		return ConnectionState{}, err
	}
	if strings.TrimSpace(req.PasskeyResponse) == "" {
		return ConnectionState{}, fmt.Errorf("passkey response is required")
	}

	var response types.WebAuthnResponse
	if err := json.Unmarshal([]byte(req.PasskeyResponse), &response); err != nil {
		connectionFlowLog("whatsmeow.provider.passkey_response.decode_error", map[string]any{
			"trace_id":              req.DebugTraceID,
			"layer":                 "worker_whatsmeow.provider",
			"worker_id":             firstNonEmpty(req.WorkerID, m.cfg.WorkerID),
			"account_id":            firstNonEmpty(req.AccountID, m.cfg.AccountID),
			"worker_type_id":        WorkerTypeWhatsmeow,
			"connection_attempt_id": req.ConnectionAttemptID,
			"reason":                safeOperationalErrorCode(err),
			"has_passkey_response":  req.PasskeyResponse != "",
			"passkey_response_len":  len(req.PasskeyResponse),
		})
		return ConnectionState{}, fmt.Errorf("failed to decode passkey response: %w", err)
	}

	client := m.getClient()
	if client == nil {
		return ConnectionState{}, fmt.Errorf("whatsmeow client is not initialized")
	}
	if _, err := invokeWhatsmeowProviderOperationWithDeadline(
		ctx,
		m,
		client,
		"passkey_response",
		m.cfg.SendTimeout,
		func(invokeCtx context.Context) (struct{}, error) {
			return struct{}{}, client.SendPasskeyResponse(invokeCtx, &response)
		},
	); err != nil {
		connectionFlowLog("whatsmeow.provider.passkey_response.send_error", map[string]any{
			"trace_id":              req.DebugTraceID,
			"layer":                 "worker_whatsmeow.provider",
			"worker_id":             firstNonEmpty(req.WorkerID, m.cfg.WorkerID),
			"account_id":            firstNonEmpty(req.AccountID, m.cfg.AccountID),
			"worker_type_id":        WorkerTypeWhatsmeow,
			"connection_attempt_id": req.ConnectionAttemptID,
			"reason":                safeOperationalErrorCode(err),
		})
		return ConnectionState{}, fmt.Errorf("failed to send passkey response: %w", err)
	}
	connectionFlowLog("whatsmeow.provider.passkey_response.sent_to_client", map[string]any{
		"trace_id":              req.DebugTraceID,
		"layer":                 "worker_whatsmeow.provider",
		"worker_id":             firstNonEmpty(req.WorkerID, m.cfg.WorkerID),
		"account_id":            firstNonEmpty(req.AccountID, m.cfg.AccountID),
		"worker_type_id":        WorkerTypeWhatsmeow,
		"connection_attempt_id": req.ConnectionAttemptID,
	})

	m.clearCurrentPasskeyRequest()
	m.mu.Lock()
	m.connected = false
	m.status = "connecting"
	m.code = CodePairingInProgress
	m.mu.Unlock()
	m.publishState(ctx, "connecting", CodePairingInProgress, WorkerStatusDisponible, "", "", true)

	state := m.currentConnectionState()
	state.Code = CodePairingInProgress
	state.Status = "connecting"
	state.WorkerStatusID = WorkerStatusDisponible
	state.IsNewLogin = true
	state.PasskeyPending = false
	state.PasskeyPublicKey = ""
	return state, nil
}

func (m *WhatsAppManager) ConfirmPasskey(ctx context.Context, req PasskeyConfirmationRequest) (ConnectionState, error) {
	if req.DebugTraceID != "" {
		m.setDebugTraceID(req.DebugTraceID)
	}
	currentState := m.currentConnectionState()
	connectionFlowLog("whatsmeow.provider.passkey_confirmation.received", map[string]any{
		"trace_id":              req.DebugTraceID,
		"layer":                 "worker_whatsmeow.provider",
		"worker_id":             firstNonEmpty(req.WorkerID, m.cfg.WorkerID),
		"account_id":            firstNonEmpty(req.AccountID, m.cfg.AccountID),
		"worker_type_id":        WorkerTypeWhatsmeow,
		"connection_attempt_id": req.ConnectionAttemptID,
		"active_attempt_id":     m.getConnectionAttemptID(),
		"status":                currentState.Status,
		"code":                  currentState.Code,
	})
	if err := m.validatePasskeyRequest(req.WorkerID, req.AccountID, req.ConnectionAttemptID); err != nil {
		connectionFlowLog("whatsmeow.provider.passkey_confirmation.invalid_context", map[string]any{
			"trace_id":              req.DebugTraceID,
			"layer":                 "worker_whatsmeow.provider",
			"worker_id":             firstNonEmpty(req.WorkerID, m.cfg.WorkerID),
			"account_id":            firstNonEmpty(req.AccountID, m.cfg.AccountID),
			"worker_type_id":        WorkerTypeWhatsmeow,
			"connection_attempt_id": req.ConnectionAttemptID,
			"active_attempt_id":     m.getConnectionAttemptID(),
			"reason":                safeOperationalErrorCode(err),
		})
		return ConnectionState{}, err
	}

	client := m.getClient()
	if client == nil {
		return ConnectionState{}, fmt.Errorf("whatsmeow client is not initialized")
	}
	if _, err := invokeWhatsmeowProviderOperationWithDeadline(
		ctx,
		m,
		client,
		"passkey_confirmation",
		m.cfg.SendTimeout,
		func(invokeCtx context.Context) (struct{}, error) {
			return struct{}{}, client.SendPasskeyConfirmation(invokeCtx)
		},
	); err != nil {
		connectionFlowLog("whatsmeow.provider.passkey_confirmation.send_error", map[string]any{
			"trace_id":              req.DebugTraceID,
			"layer":                 "worker_whatsmeow.provider",
			"worker_id":             firstNonEmpty(req.WorkerID, m.cfg.WorkerID),
			"account_id":            firstNonEmpty(req.AccountID, m.cfg.AccountID),
			"worker_type_id":        WorkerTypeWhatsmeow,
			"connection_attempt_id": req.ConnectionAttemptID,
			"reason":                safeOperationalErrorCode(err),
		})
		return ConnectionState{}, fmt.Errorf("failed to confirm passkey pairing: %w", err)
	}
	connectionFlowLog("whatsmeow.provider.passkey_confirmation.sent_to_client", map[string]any{
		"trace_id":              req.DebugTraceID,
		"layer":                 "worker_whatsmeow.provider",
		"worker_id":             firstNonEmpty(req.WorkerID, m.cfg.WorkerID),
		"account_id":            firstNonEmpty(req.AccountID, m.cfg.AccountID),
		"worker_type_id":        WorkerTypeWhatsmeow,
		"connection_attempt_id": req.ConnectionAttemptID,
	})

	m.clearLoginArtifacts()
	m.mu.Lock()
	m.connected = false
	m.status = "connecting"
	m.code = CodePairingInProgress
	m.mu.Unlock()
	m.publishState(ctx, "connecting", CodePairingInProgress, WorkerStatusDisponible, "", "", true)

	state := m.currentConnectionState()
	state.Code = CodePairingInProgress
	state.Status = "connecting"
	state.WorkerStatusID = WorkerStatusDisponible
	state.IsNewLogin = true
	return state, nil
}

func (m *WhatsAppManager) ValidatePhone(ctx context.Context, req PhoneValidationRequest) (PhoneValidationResponse, error) {
	return m.validatePhone(ctx, req, nil)
}

func (m *WhatsAppManager) ValidatePhoneWithAuthorization(
	ctx context.Context,
	req PhoneValidationRequest,
	authorize providerAuthorizationGuard,
) (PhoneValidationResponse, error) {
	if authorize == nil {
		return PhoneValidationResponse{}, errors.New("provider authorization guard is required")
	}
	return m.validatePhone(ctx, req, authorize)
}

func (m *WhatsAppManager) validatePhone(
	ctx context.Context,
	req PhoneValidationRequest,
	authorize providerAuthorizationGuard,
) (PhoneValidationResponse, error) {
	startedAt := time.Now()
	transportEffects := &providerTransportEffectTracker{}
	ctx = withProviderTransportEffectTracker(ctx, transportEffects)
	resp := PhoneValidationResponse{
		RequestID: req.RequestID,
		AccountID: firstNonEmpty(req.AccountID, m.cfg.AccountID),
		WorkerID:  firstNonEmpty(req.WorkerID, m.cfg.WorkerID),
	}
	candidates := buildPhoneValidationCandidates(req.PhoneDDI, req.Phone)
	if len(candidates) == 0 {
		resp.Error = "phone is required"
		return resp, nil
	}
	client := m.getClient()
	if client == nil {
		return resp, errors.New("client is not initialized")
	}

	var deferredLIDFallback *PhoneValidationResponse
	hadDefinitiveNegative := false
	for _, candidate := range candidates {
		var (
			results []types.IsOnWhatsAppResponse
			err     error
		)
		if authorize == nil {
			results, err = invokeWhatsmeowProviderOperationWithDeadline(
				ctx,
				m,
				client,
				"validate_phone:"+candidate,
				m.cfg.SendTimeout,
				func(invokeCtx context.Context) ([]types.IsOnWhatsAppResponse, error) {
					return client.IsOnWhatsApp(
						invokeCtx,
						[]string{"+" + candidate},
					)
				},
			)
			transportEffects.record(err)
		} else {
			results, err = invokeProviderAuthorizedCall(ctx, authorize, func(invokeCtx context.Context) ([]types.IsOnWhatsAppResponse, error) {
				return client.IsOnWhatsApp(invokeCtx, []string{"+" + candidate})
			})
		}
		if err != nil {
			if transportErr, invoked := transportEffects.failure(); transportErr != nil {
				m.recordOutboundFailureWithInvocation(
					ctx,
					ChatMessage{},
					time.Since(startedAt),
					transportErr,
					invoked,
				)
			}
			if errors.Is(err, errKafkaConsumerDispatchRevoked) ||
				errors.Is(err, errWhatsAppRuntimeFenceRevoked) {
				return resp, err
			}
			// Provider/transport failures are retryable. Keep them in the Go
			// error channel so notification/webhook Kafka handlers never confuse
			// an outage with a definitive invalid phone.
			return resp, fmt.Errorf("WhatsApp phone validation provider failed: %w", err)
		}
		if len(results) == 0 {
			log.Printf("whatsmeow phone validation candidate worker_id=%s request_id_hash=%s candidate_hash=%s result=empty", m.cfg.WorkerID, hashConnectionFlowIdentifier(req.RequestID), hashConnectionFlowIdentifier(candidate))
			continue
		}

		result := results[0]
		jid := normalizeValidationJID(result.JID)
		log.Printf(
			"whatsmeow phone validation candidate worker_id=%s request_id_hash=%s candidate_hash=%s query_hash=%s exists=%t jid_hash=%s",
			m.cfg.WorkerID,
			hashConnectionFlowIdentifier(req.RequestID),
			hashConnectionFlowIdentifier(candidate),
			hashConnectionFlowIdentifier(result.Query),
			result.IsIn,
			hashConnectionFlowIdentifier(jid),
		)
		if !result.IsIn {
			hadDefinitiveNegative = true
			continue
		}
		if jid == "" {
			return resp, errors.New("WhatsApp phone validation provider returned an empty JID for a registered phone")
		}

		validResponse := resp
		validResponse.Valid = true
		validResponse.JID = jid

		if result.JID.Server == types.HiddenUserServer {
			if phone := m.resolveReliablePhoneFromLID(ctx, client, result.JID.ToNonAD(), candidates); phone != "" {
				validResponse.Phone = phone
				return validResponse, nil
			}
			if deferredLIDFallback == nil {
				fallback := validResponse
				fallback.Phone = candidate
				deferredLIDFallback = &fallback
			}
			continue
		}

		if phone := phoneFromJID(jid); phone != "" {
			validResponse.Phone = phone
		} else {
			validResponse.Phone = candidate
		}
		return validResponse, nil
	}

	if deferredLIDFallback != nil {
		return *deferredLIDFallback, nil
	}
	if !hadDefinitiveNegative {
		return resp, errors.New("WhatsApp phone validation provider returned no definitive result")
	}

	resp.Valid = false
	return resp, nil
}

func buildPhoneValidationCandidates(phoneDDI, phone string) []string {
	fullNumber := digits(phoneDDI + phone)
	if fullNumber == "" {
		return nil
	}
	if !strings.HasPrefix(fullNumber, "55") {
		return []string{fullNumber}
	}

	rest := fullNumber[2:]
	if len(rest) < 10 {
		return []string{fullNumber}
	}

	ddd := rest[:2]
	local := rest[2:]
	without9Local := local
	if len(local) == 9 && strings.HasPrefix(local, "9") {
		without9Local = local[1:]
	}
	with9Local := local
	if len(local) == 8 {
		with9Local = "9" + local
	}

	without9 := "55" + ddd + without9Local
	with9 := "55" + ddd + with9Local
	fallback := with9
	if fullNumber == with9 {
		fallback = without9
	}
	return uniqueStrings([]string{fullNumber, fallback})
}

func uniqueStrings(values []string) []string {
	out := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}

func normalizeValidationJID(jid types.JID) string {
	if jid.IsEmpty() || jid.User == "" {
		return ""
	}
	normalized := jid.ToNonAD()
	if normalized.Server == types.LegacyUserServer {
		normalized.Server = types.DefaultUserServer
	}
	return normalized.String()
}

func (m *WhatsAppManager) resolveReliablePhoneFromLID(ctx context.Context, client *whatsmeow.Client, lid types.JID, candidates []string) string {
	if client == nil || client.Store == nil || client.Store.LIDs == nil || lid.Server != types.HiddenUserServer {
		return ""
	}
	pn, err := client.Store.LIDs.GetPNForLID(ctx, lid)
	if err != nil || pn.IsEmpty() {
		log.Printf("whatsmeow phone validation lid mapping not found worker_id=%s lid_hash=%s error_code=%s", m.cfg.WorkerID, hashConnectionFlowIdentifier(lid.String()), safeOperationalErrorCode(err))
		return ""
	}
	phone := phoneFromJID(normalizeValidationJID(pn))
	if !isReliablePhoneForLID(lid, phone, candidates) {
		log.Printf("whatsmeow phone validation lid mapping discarded worker_id=%s lid_hash=%s resolved_phone_hash=%s", m.cfg.WorkerID, hashConnectionFlowIdentifier(lid.String()), hashConnectionFlowIdentifier(phone))
		return ""
	}
	return phone
}

func isReliablePhoneForLID(lid types.JID, phone string, candidates []string) bool {
	if phone == "" {
		return false
	}
	if digits(lid.User) == digits(phone) {
		return false
	}
	for _, candidate := range candidates {
		if phone == candidate {
			return true
		}
	}
	return false
}

func (m *WhatsAppManager) connectionContext() context.Context {
	if m.runtimeCtx != nil {
		return m.runtimeCtx
	}
	return context.Background()
}

func (m *WhatsAppManager) isAuthenticated(client *whatsmeow.Client) bool {
	return client != nil &&
		client.Store != nil &&
		client.Store.ID != nil &&
		client.IsLoggedIn()
}

func (m *WhatsAppManager) publishConnectedIfAuthenticated(ctx context.Context, reason string) bool {
	if m.isProviderProcessQuarantined() {
		return false
	}
	client := m.getClient()
	if client == nil || client.Store == nil || client.Store.ID == nil {
		return false
	}

	if !m.isVerifiedCurrentProviderConnection(client) {
		return false
	}

	lifecycleEvent := m.beginProviderLifecycleEvent(false)
	phone := phoneFromOwnID(client.Store.ID)
	log.Printf("whatsmeow already connected worker_id=%s reason=%s", m.cfg.WorkerID, reason)
	scope, err := m.activateVerifiedInboundConnectionScope(ctx, client, reason)
	if err != nil {
		log.Printf(
			"whatsmeow authenticated connection runtime fence activation skipped worker_id=%s generation=%d reason=%s error_code=%s",
			m.cfg.WorkerID,
			m.cfg.RuntimeGeneration,
			reason,
			safeOperationalErrorCode(err),
		)
		if !m.applyProviderLifecycleState(lifecycleEvent.serial, func() {
			m.connected = false
			m.status = "connecting"
			m.code = CodeAwaitConnection
			m.degradedReason = "runtime_fence_activation_failed"
		}) {
			return true
		}
		m.publishState(ctx, "connecting", CodeAwaitConnection, WorkerStatusDisponible, phone, "", false)
		m.scheduleRuntimeFenceRecovery(client, reason, lifecycleEvent.serial)
		return true
	}
	if !m.applyProviderLifecycleState(lifecycleEvent.serial, func() {
		m.connected = true
		m.status = "connected"
		m.code = CodeConnectionEstablished
		m.lastKeepAliveAt = time.Now()
		m.keepAliveFailures = 0
		m.consecutiveSendFailures = 0
		m.degradedReason = ""
	}) {
		m.deactivateCapturedInboundConnectionScopeAsync(&scope)
		return true
	}
	m.clearFreshLoginFallback()
	m.clearLoginArtifacts()
	ready := m.publishConnectedWhenReadyForScope(ctx, scope, reason, phone, false)
	if !ready {
		return true
	}
	return healthBool(m.ConnectionHealth(), "session_ready")
}

func (m *WhatsAppManager) setCurrentQRCode(qr string) {
	m.mu.Lock()
	m.currentQRCode = qr
	m.mu.Unlock()
}

func (m *WhatsAppManager) getCurrentQRCode() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.currentQRCode
}

func (m *WhatsAppManager) setConnectionAttemptID(connectionAttemptID string) {
	m.mu.Lock()
	m.connectionAttemptID = connectionAttemptID
	m.mu.Unlock()
}

func (m *WhatsAppManager) getConnectionAttemptID() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.connectionAttemptID
}

func (m *WhatsAppManager) clearConnectionAttemptID() {
	m.mu.Lock()
	m.connectionAttemptID = ""
	m.mu.Unlock()
}

func (m *WhatsAppManager) setDebugTraceID(debugTraceID string) {
	m.mu.Lock()
	m.debugTraceID = debugTraceID
	m.mu.Unlock()
}

func (m *WhatsAppManager) getDebugTraceID() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.debugTraceID
}

func (m *WhatsAppManager) clearDebugTraceID() {
	m.mu.Lock()
	m.debugTraceID = ""
	m.mu.Unlock()
}

func (m *WhatsAppManager) resetQRCodeReadSession(clearQRCode bool) {
	m.mu.Lock()
	m.cancelQRCodeReadSessionLocked()
	m.resetQRCodeReadSessionLocked(clearQRCode)
	m.mu.Unlock()
}

func (m *WhatsAppManager) beginQRCodeReadSession(clearQRCode bool) (uint64, <-chan struct{}) {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.cancelQRCodeReadSessionLocked()
	m.resetQRCodeReadSessionLocked(clearQRCode)
	m.qrReadSessionSerial++
	m.qrReadSessionDone = make(chan struct{})
	return m.qrReadSessionSerial, m.qrReadSessionDone
}

func (m *WhatsAppManager) cancelQRCodeReadSessionLocked() {
	if m.qrReadSessionDone == nil {
		return
	}
	close(m.qrReadSessionDone)
	m.qrReadSessionDone = nil
}

func (m *WhatsAppManager) resetQRCodeReadSessionLocked(clearQRCode bool) {
	m.qrGenerationCount = 0
	m.qrReadSessionLocked = false
	m.qrHash = ""
	if clearQRCode {
		m.currentQRCode = ""
	}
}

func (m *WhatsAppManager) recordQRCodeGeneration(raw string) (int, bool, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.qrReadSessionLocked {
		return maxQRCodeGenerations + 1, false, true
	}

	if raw != "" && raw == m.qrHash {
		return m.qrGenerationCount, true, true
	}

	if m.qrGenerationCount >= maxQRCodeGenerations {
		m.qrReadSessionLocked = true
		m.currentQRCode = ""
		m.currentPairingCode = ""
		m.currentPasskeyPublicKey = ""
		m.currentPasskeyConfirmationCode = ""
		m.currentPasskeySkipHandoffUX = false
		m.qrHash = ""
		m.qrGenerationCount = maxQRCodeGenerations + 1
		m.connected = false
		m.status = "disconnected"
		m.code = CodeConnectionClosed
		return m.qrGenerationCount, false, false
	}

	m.qrHash = raw
	m.qrGenerationCount++
	return m.qrGenerationCount, true, false
}

func (m *WhatsAppManager) recordQRCodeGenerationForSession(
	serial uint64,
	connectionAttemptID string,
	raw string,
) (attempt int, allowed bool, duplicate bool, current bool) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if serial == 0 || serial != m.qrReadSessionSerial ||
		m.qrReadSessionDone == nil || m.connectionAttemptID != connectionAttemptID {
		return 0, false, false, false
	}

	if m.qrReadSessionLocked {
		return maxQRCodeGenerations + 1, false, true, true
	}
	if raw != "" && raw == m.qrHash {
		return m.qrGenerationCount, true, true, true
	}
	if m.qrGenerationCount >= maxQRCodeGenerations {
		m.qrReadSessionLocked = true
		m.currentQRCode = ""
		m.currentPairingCode = ""
		m.currentPasskeyPublicKey = ""
		m.currentPasskeyConfirmationCode = ""
		m.currentPasskeySkipHandoffUX = false
		m.qrHash = ""
		m.qrGenerationCount = maxQRCodeGenerations + 1
		m.connected = false
		m.status = "disconnected"
		m.code = CodeConnectionClosed
		return m.qrGenerationCount, false, false, true
	}

	m.qrHash = raw
	m.qrGenerationCount++
	return m.qrGenerationCount, true, false, true
}

func (m *WhatsAppManager) isQRCodeReadSessionCurrent(
	serial uint64,
	connectionAttemptID string,
) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return serial != 0 && serial == m.qrReadSessionSerial &&
		m.qrReadSessionDone != nil && m.connectionAttemptID == connectionAttemptID
}

func (m *WhatsAppManager) setCurrentQRCodeForSession(
	serial uint64,
	connectionAttemptID string,
	qr string,
) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	if serial == 0 || serial != m.qrReadSessionSerial ||
		m.qrReadSessionDone == nil || m.connectionAttemptID != connectionAttemptID {
		return false
	}
	m.currentQRCode = qr
	return true
}

func (m *WhatsAppManager) isQRCodeReadSessionLocked() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.qrReadSessionLocked
}

func (m *WhatsAppManager) setCurrentPairingCode(code string) {
	m.mu.Lock()
	m.currentPairingCode = code
	m.mu.Unlock()
}

func (m *WhatsAppManager) getCurrentPairingCode() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.currentPairingCode
}

func (m *WhatsAppManager) setCurrentPasskeyRequest(publicKey string) {
	m.mu.Lock()
	m.connected = false
	m.status = "connecting"
	m.code = CodeAwaitingPasskey
	m.currentQRCode = ""
	m.currentPairingCode = ""
	m.currentPasskeyPublicKey = publicKey
	m.currentPasskeyConfirmationCode = ""
	m.currentPasskeySkipHandoffUX = false
	m.mu.Unlock()
}

func (m *WhatsAppManager) setCurrentPasskeyConfirmation(code string, skipHandoffUX bool) {
	m.mu.Lock()
	m.connected = false
	m.status = "connecting"
	m.code = CodeAwaitingPasskeyConfirmation
	m.currentQRCode = ""
	m.currentPairingCode = ""
	m.currentPasskeyPublicKey = ""
	m.currentPasskeyConfirmationCode = code
	m.currentPasskeySkipHandoffUX = skipHandoffUX
	m.mu.Unlock()
}

func (m *WhatsAppManager) clearCurrentPasskeyRequest() {
	m.mu.Lock()
	m.currentPasskeyPublicKey = ""
	m.mu.Unlock()
}

func (m *WhatsAppManager) clearLoginArtifacts() {
	m.mu.Lock()
	m.currentQRCode = ""
	m.currentPairingCode = ""
	m.currentPasskeyPublicKey = ""
	m.currentPasskeyConfirmationCode = ""
	m.currentPasskeySkipHandoffUX = false
	m.mu.Unlock()
}

func qrCodeDataURL(raw string) string {
	png, err := qrcode.Encode(raw, qrcode.Medium, 256)
	if err != nil {
		log.Printf("failed to render qrcode image error_code=%s", safeOperationalErrorCode(err))
		return raw
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(png)
}

func (m *WhatsAppManager) connectClient(ctx context.Context, client *whatsmeow.Client, stage string) error {
	startedAt := time.Now()
	if m.isProviderClientStalled(client) {
		return fmt.Errorf(
			"%w: connect stage=%s",
			errWhatsmeowProviderClientFenced,
			stage,
		)
	}
	log.Printf(
		"whatsmeow connect start worker_id=%s stage=%s has_store_id=%t timeout=%s",
		m.cfg.WorkerID,
		stage,
		client != nil && client.Store != nil && client.Store.ID != nil,
		m.cfg.WhatsAppConnectTimeout,
	)

	errCh := make(chan error, 1)
	go func() {
		errCh <- client.ConnectContext(ctx)
	}()

	var timeout <-chan time.Time
	if m.cfg.WhatsAppConnectTimeout > 0 {
		timeout = time.After(m.cfg.WhatsAppConnectTimeout)
	}

	select {
	case err := <-errCh:
		if err != nil {
			log.Printf("whatsmeow connect failed worker_id=%s stage=%s elapsed=%s error_code=%s", m.cfg.WorkerID, stage, time.Since(startedAt), safeOperationalErrorCode(err))
			return err
		}
	case <-timeout:
		err := fmt.Errorf("whatsmeow connect timeout after %s", m.cfg.WhatsAppConnectTimeout)
		m.quarantineProviderClient(client, "connect:"+stage, err)
		go func() {
			lateErr := <-errCh
			log.Printf(
				"whatsmeow connect settled after application timeout worker_id=%s stage=%s error_code=%s",
				m.cfg.WorkerID,
				stage,
				safeOperationalErrorCode(lateErr),
			)
		}()
		log.Printf("whatsmeow connect failed worker_id=%s stage=%s elapsed=%s error_code=%s", m.cfg.WorkerID, stage, time.Since(startedAt), safeOperationalErrorCode(err))
		return err
	case <-ctx.Done():
		err := ctx.Err()
		m.quarantineProviderClient(client, "connect:"+stage, err)
		go func() {
			lateErr := <-errCh
			log.Printf(
				"whatsmeow connect settled after caller cancellation worker_id=%s stage=%s error_code=%s",
				m.cfg.WorkerID,
				stage,
				safeOperationalErrorCode(lateErr),
			)
		}()
		log.Printf("whatsmeow connect failed worker_id=%s stage=%s elapsed=%s error_code=%s", m.cfg.WorkerID, stage, time.Since(startedAt), safeOperationalErrorCode(err))
		return err
	}

	log.Printf("whatsmeow connect returned worker_id=%s stage=%s elapsed=%s", m.cfg.WorkerID, stage, time.Since(startedAt))
	return nil
}

func (m *WhatsAppManager) connectWithQRCode(ctx context.Context) (ConnectionState, error) {
	return m.connectWithQRCodeInternal(ctx, true)
}

func (m *WhatsAppManager) connectWithQRCodeInternal(ctx context.Context, allowDeletedStoreRetry bool) (ConnectionState, error) {
	if err := m.rejectLoginDuringProviderHandoff(ctx, "qrcode"); err != nil {
		return ConnectionState{}, err
	}
	traceID := m.getDebugTraceID()
	connectionAttemptID := m.getConnectionAttemptID()
	startedAt := time.Now()
	m.debug.Log(ctx, "whatsmeow.provider.qrcode.connect_start", map[string]any{
		"trace_id":              traceID,
		"layer":                 "worker_whatsmeow.provider",
		"worker_id":             m.cfg.WorkerID,
		"account_id":            m.cfg.AccountID,
		"worker_type_id":        WorkerTypeWhatsmeow,
		"connection_attempt_id": m.getConnectionAttemptID(),
		"runtime_generation":    m.cfg.RuntimeGeneration,
		"allow_deleted_retry":   allowDeletedStoreRetry,
	})
	client, err := m.ensureUsableClientForLogin(ctx, "qrcode-request")
	if err != nil {
		m.debug.Log(ctx, "whatsmeow.provider.qrcode.ensure_client.error", map[string]any{
			"trace_id":              traceID,
			"layer":                 "worker_whatsmeow.provider",
			"worker_id":             m.cfg.WorkerID,
			"account_id":            m.cfg.AccountID,
			"worker_type_id":        WorkerTypeWhatsmeow,
			"connection_attempt_id": m.getConnectionAttemptID(),
			"runtime_generation":    m.cfg.RuntimeGeneration,
			"duration_ms":           time.Since(startedAt).Milliseconds(),
			"error_code":            safeOperationalErrorCode(err),
		})
		m.publishState(ctx, "disconnected", CodeConnectionLost, WorkerStatusDisponible, "", "", false)
		return ConnectionState{}, err
	}
	connectCtx := m.connectionContext()
	if m.isAuthenticated(client) {
		m.debug.Log(ctx, "whatsmeow.provider.qrcode.already_authenticated", map[string]any{
			"trace_id":              traceID,
			"layer":                 "worker_whatsmeow.provider",
			"worker_id":             m.cfg.WorkerID,
			"account_id":            m.cfg.AccountID,
			"worker_type_id":        WorkerTypeWhatsmeow,
			"connection_attempt_id": m.getConnectionAttemptID(),
			"runtime_generation":    m.cfg.RuntimeGeneration,
			"duration_ms":           time.Since(startedAt).Milliseconds(),
		})
		log.Printf("whatsmeow qrcode request already authenticated worker_id=%s", m.cfg.WorkerID)
		m.clearFreshLoginFallback()
		m.clearLoginArtifacts()
		m.resetQRCodeReadSession(true)
		m.publishConnectedWhenReady(ctx, "qrcode-already-authenticated", phoneFromOwnID(client.Store.ID), false)
		return m.currentConnectionState(), nil
	}
	m.resetQRCodeReadSession(true)
	if client.IsConnected() {
		if client.Store.ID != nil {
			m.debug.Log(ctx, "whatsmeow.provider.qrcode.authentication_in_progress", map[string]any{
				"trace_id":              traceID,
				"layer":                 "worker_whatsmeow.provider",
				"worker_id":             m.cfg.WorkerID,
				"account_id":            m.cfg.AccountID,
				"worker_type_id":        WorkerTypeWhatsmeow,
				"connection_attempt_id": m.getConnectionAttemptID(),
				"runtime_generation":    m.cfg.RuntimeGeneration,
			})
			log.Printf("whatsmeow qrcode request authentication in progress worker_id=%s", m.cfg.WorkerID)
			return m.currentConnectionState(), nil
		}
		m.debug.Log(ctx, "whatsmeow.provider.qrcode.restart_active_scan", map[string]any{
			"trace_id":              traceID,
			"layer":                 "worker_whatsmeow.provider",
			"worker_id":             m.cfg.WorkerID,
			"account_id":            m.cfg.AccountID,
			"worker_type_id":        WorkerTypeWhatsmeow,
			"connection_attempt_id": m.getConnectionAttemptID(),
			"runtime_generation":    m.cfg.RuntimeGeneration,
		})
		log.Printf("whatsmeow qrcode request restarting active scan worker_id=%s", m.cfg.WorkerID)
		client.Disconnect()
		m.clearLoginArtifacts()
	}
	if client.Store.ID != nil {
		m.debug.Log(ctx, "whatsmeow.provider.qrcode.stored_session", map[string]any{
			"trace_id":              traceID,
			"layer":                 "worker_whatsmeow.provider",
			"worker_id":             m.cfg.WorkerID,
			"account_id":            m.cfg.AccountID,
			"worker_type_id":        WorkerTypeWhatsmeow,
			"connection_attempt_id": m.getConnectionAttemptID(),
			"runtime_generation":    m.cfg.RuntimeGeneration,
		})
		log.Printf("whatsmeow qrcode request using stored session worker_id=%s", m.cfg.WorkerID)
		m.armFreshLoginFallback(freshLoginRequest{Type: "qrcode"})
		m.publishState(ctx, "connecting", CodeAwaitConnection, WorkerStatusDisponible, "", "", false)
		if err := m.connectClient(connectCtx, client, "qrcode-stored-session"); err != nil {
			return ConnectionState{}, m.handleStoredSessionConnectError(ctx, err)
		}
		return m.currentConnectionState(), nil
	}

	log.Printf("whatsmeow qrcode request starting new login worker_id=%s", m.cfg.WorkerID)
	m.debug.Log(ctx, "whatsmeow.provider.qrcode.new_login_start", map[string]any{
		"trace_id":              traceID,
		"layer":                 "worker_whatsmeow.provider",
		"worker_id":             m.cfg.WorkerID,
		"account_id":            m.cfg.AccountID,
		"worker_type_id":        WorkerTypeWhatsmeow,
		"connection_attempt_id": m.getConnectionAttemptID(),
		"runtime_generation":    m.cfg.RuntimeGeneration,
	})
	m.clearFreshLoginFallback()
	m.clearLoginArtifacts()
	qrReadSessionSerial, qrReadSessionDone := m.beginQRCodeReadSession(true)
	qrChan, err := client.GetQRChannel(connectCtx)
	if err != nil {
		m.resetQRCodeReadSession(true)
		m.debug.Log(ctx, "whatsmeow.provider.qrcode.channel_error", map[string]any{
			"trace_id":              traceID,
			"layer":                 "worker_whatsmeow.provider",
			"worker_id":             m.cfg.WorkerID,
			"account_id":            m.cfg.AccountID,
			"worker_type_id":        WorkerTypeWhatsmeow,
			"connection_attempt_id": m.getConnectionAttemptID(),
			"runtime_generation":    m.cfg.RuntimeGeneration,
			"duration_ms":           time.Since(startedAt).Milliseconds(),
			"error_code":            safeOperationalErrorCode(err),
		})
		log.Printf("whatsmeow GetQRChannel failed worker_id=%s error_code=%s", m.cfg.WorkerID, safeOperationalErrorCode(err))
		if err := m.handleFreshLoginConnectError(ctx, freshLoginRequest{Type: "qrcode"}, err, allowDeletedStoreRetry); err != nil {
			return ConnectionState{}, err
		}
		return m.currentConnectionState(), nil
	}
	m.publishState(ctx, "connecting", CodeAwaitingReadQRCode, WorkerStatusDisponible, "", "", true)
	if err := m.connectClient(connectCtx, client, "qrcode-new-login"); err != nil {
		m.debug.Log(ctx, "whatsmeow.provider.qrcode.connect_error", map[string]any{
			"trace_id":              traceID,
			"layer":                 "worker_whatsmeow.provider",
			"worker_id":             m.cfg.WorkerID,
			"account_id":            m.cfg.AccountID,
			"worker_type_id":        WorkerTypeWhatsmeow,
			"connection_attempt_id": m.getConnectionAttemptID(),
			"runtime_generation":    m.cfg.RuntimeGeneration,
			"duration_ms":           time.Since(startedAt).Milliseconds(),
			"error_code":            safeOperationalErrorCode(err),
		})
		if err := m.handleFreshLoginConnectError(ctx, freshLoginRequest{Type: "qrcode"}, err, allowDeletedStoreRetry); err != nil {
			return ConnectionState{}, err
		}
		return m.currentConnectionState(), nil
	}

	resultCh := make(chan ConnectionState, 1)
	var resultOnce sync.Once
	qrWaitStartedAt := time.Now()
	sendResult := func(state ConnectionState) {
		resultOnce.Do(func() {
			resultCh <- state
		})
	}

	go func() {
		for {
			var evt whatsmeow.QRChannelItem
			var open bool
			select {
			case <-qrReadSessionDone:
				m.debug.Log(context.Background(), "whatsmeow.provider.qrcode.reader_superseded", map[string]any{
					"trace_id":              traceID,
					"layer":                 "worker_whatsmeow.provider",
					"worker_id":             m.cfg.WorkerID,
					"account_id":            m.cfg.AccountID,
					"worker_type_id":        WorkerTypeWhatsmeow,
					"connection_attempt_id": connectionAttemptID,
					"runtime_generation":    m.cfg.RuntimeGeneration,
				})
				return
			case evt, open = <-qrChan:
				if !open {
					if m.isQRCodeReadSessionCurrent(qrReadSessionSerial, connectionAttemptID) {
						m.debug.Log(context.Background(), "whatsmeow.provider.qrcode.channel_closed", map[string]any{
							"trace_id":              traceID,
							"layer":                 "worker_whatsmeow.provider",
							"worker_id":             m.cfg.WorkerID,
							"account_id":            m.cfg.AccountID,
							"worker_type_id":        WorkerTypeWhatsmeow,
							"connection_attempt_id": connectionAttemptID,
							"runtime_generation":    m.cfg.RuntimeGeneration,
						})
						log.Printf("whatsmeow qr channel closed worker_id=%s", m.cfg.WorkerID)
					}
					return
				}
			}
			if !m.isQRCodeReadSessionCurrent(qrReadSessionSerial, connectionAttemptID) {
				return
			}
			switch evt.Event {
			case "code":
				attempt, allowed, duplicate, current := m.recordQRCodeGenerationForSession(
					qrReadSessionSerial,
					connectionAttemptID,
					evt.Code,
				)
				if !current {
					return
				}
				m.debug.Log(context.Background(), "whatsmeow.provider.qrcode.event", map[string]any{
					"trace_id":              traceID,
					"layer":                 "worker_whatsmeow.provider",
					"worker_id":             m.cfg.WorkerID,
					"account_id":            m.cfg.AccountID,
					"worker_type_id":        WorkerTypeWhatsmeow,
					"connection_attempt_id": m.getConnectionAttemptID(),
					"runtime_generation":    m.cfg.RuntimeGeneration,
					"event":                 evt.Event,
					"attempt":               attempt,
					"max_attempts":          maxQRCodeGenerations,
					"duplicate":             duplicate,
					"allowed":               allowed,
					"timeout":               evt.Timeout.String(),
					"has_qr":                evt.Code != "",
					"qr_length":             len(evt.Code),
				})
				if duplicate {
					continue
				}
				if !allowed {
					m.debug.Log(context.Background(), "whatsmeow.provider.qrcode.limit_reached", map[string]any{
						"trace_id":              traceID,
						"layer":                 "worker_whatsmeow.provider",
						"worker_id":             m.cfg.WorkerID,
						"account_id":            m.cfg.AccountID,
						"worker_type_id":        WorkerTypeWhatsmeow,
						"connection_attempt_id": m.getConnectionAttemptID(),
						"runtime_generation":    m.cfg.RuntimeGeneration,
						"attempt":               attempt,
						"max_attempts":          maxQRCodeGenerations,
					})
					log.Printf("whatsmeow qr generation limit reached worker_id=%s attempt=%d max_attempts=%d", m.cfg.WorkerID, attempt, maxQRCodeGenerations)
					client.Disconnect()
					m.publishStateWithAttempts(context.Background(), "disconnected", CodeConnectionClosed, WorkerStatusDisponible, "", "", true, attempt, maxQRCodeGenerations)
					sendResult(ConnectionState{
						Code:              CodeConnectionClosed,
						Status:            "disconnected",
						WorkerID:          m.cfg.WorkerID,
						AccountID:         m.cfg.AccountID,
						WorkerTypeID:      WorkerTypeWhatsmeow,
						IsNewLogin:        true,
						Time:              time.Now().Unix(),
						WorkerStatusID:    WorkerStatusDisponible,
						Attempt:           attempt,
						MaxAttempts:       maxQRCodeGenerations,
						DebugTraceID:      traceID,
						RuntimeGeneration: m.cfg.RuntimeGeneration,
						WarmPoolID:        m.cfg.WarmPoolID,
					})
					return
				}
				qrImage := qrCodeDataURL(evt.Code)
				m.debug.Log(context.Background(), "whatsmeow.provider.qrcode.dataurl_generated", map[string]any{
					"trace_id":              traceID,
					"layer":                 "worker_whatsmeow.provider",
					"worker_id":             m.cfg.WorkerID,
					"account_id":            m.cfg.AccountID,
					"worker_type_id":        WorkerTypeWhatsmeow,
					"connection_attempt_id": m.getConnectionAttemptID(),
					"runtime_generation":    m.cfg.RuntimeGeneration,
					"attempt":               attempt,
					"max_attempts":          maxQRCodeGenerations,
					"has_qr":                qrImage != "",
					"qr_length":             len(qrImage),
				})
				if !m.setCurrentQRCodeForSession(
					qrReadSessionSerial,
					connectionAttemptID,
					qrImage,
				) {
					return
				}
				qrGeneratedAt := time.Now().UTC().Format(time.RFC3339Nano)
				timeToFirstQRMS := int(time.Since(qrWaitStartedAt).Milliseconds())
				log.Printf("whatsmeow qr code received worker_id=%s timeout=%s attempt=%d max_attempts=%d", m.cfg.WorkerID, evt.Timeout, attempt, maxQRCodeGenerations)
				m.publishStateWithAttemptMetadata(context.Background(), "connecting", CodeAwaitingReadQRCode, WorkerStatusDisponible, "", qrImage, true, attempt, maxQRCodeGenerations, qrGeneratedAt, timeToFirstQRMS)
				sendResult(ConnectionState{
					Code:              CodeAwaitingReadQRCode,
					Status:            "connecting",
					WorkerID:          m.cfg.WorkerID,
					AccountID:         m.cfg.AccountID,
					WorkerTypeID:      WorkerTypeWhatsmeow,
					QRCode:            qrImage,
					IsNewLogin:        true,
					Time:              time.Now().Unix(),
					WorkerStatusID:    WorkerStatusDisponible,
					Attempt:           attempt,
					MaxAttempts:       maxQRCodeGenerations,
					QRGeneratedAt:     qrGeneratedAt,
					TimeToFirstQRMS:   timeToFirstQRMS,
					DebugTraceID:      traceID,
					RuntimeGeneration: m.cfg.RuntimeGeneration,
					WarmPoolID:        m.cfg.WarmPoolID,
				})
			case whatsmeow.QRChannelEventPasskeyRequest:
				passkeyPublicKey, ok := m.handlePairPasskeyRequestEvent(context.Background(), evt.PasskeyRequest, "qr-channel")
				if !ok {
					continue
				}
				sendResult(ConnectionState{
					Code:                CodeAwaitingPasskey,
					Status:              "connecting",
					WorkerID:            m.cfg.WorkerID,
					AccountID:           m.cfg.AccountID,
					WorkerTypeID:        WorkerTypeWhatsmeow,
					IsNewLogin:          true,
					Time:                time.Now().Unix(),
					WorkerStatusID:      WorkerStatusDisponible,
					PasskeyPublicKey:    passkeyPublicKey,
					PasskeyPending:      true,
					ConnectionAttemptID: m.getConnectionAttemptID(),
					DebugTraceID:        traceID,
					RuntimeGeneration:   m.cfg.RuntimeGeneration,
					WarmPoolID:          m.cfg.WarmPoolID,
				})
			case whatsmeow.QRChannelEventPasskeyResponse:
				confirmationCode, ok := m.handlePairPasskeyConfirmationEvent(context.Background(), evt.PasskeyConfirmation, "qr-channel")
				if !ok {
					continue
				}
				sendResult(ConnectionState{
					Code:                    CodeAwaitingPasskeyConfirmation,
					Status:                  "connecting",
					WorkerID:                m.cfg.WorkerID,
					AccountID:               m.cfg.AccountID,
					WorkerTypeID:            WorkerTypeWhatsmeow,
					IsNewLogin:              true,
					Time:                    time.Now().Unix(),
					WorkerStatusID:          WorkerStatusDisponible,
					PasskeyConfirmationCode: confirmationCode,
					PasskeySkipHandoffUX:    evt.PasskeyConfirmation.SkipHandoffUX,
					ConnectionAttemptID:     m.getConnectionAttemptID(),
					DebugTraceID:            traceID,
					RuntimeGeneration:       m.cfg.RuntimeGeneration,
					WarmPoolID:              m.cfg.WarmPoolID,
				})
			case "success":
				m.clearLoginArtifacts()
				m.resetQRCodeReadSession(true)
				m.debug.Log(context.Background(), "whatsmeow.provider.qrcode.scanned", map[string]any{
					"trace_id":              traceID,
					"layer":                 "worker_whatsmeow.provider",
					"worker_id":             m.cfg.WorkerID,
					"account_id":            m.cfg.AccountID,
					"worker_type_id":        WorkerTypeWhatsmeow,
					"connection_attempt_id": m.getConnectionAttemptID(),
					"runtime_generation":    m.cfg.RuntimeGeneration,
				})
				log.Printf("whatsmeow qr scanned, pairing in progress worker_id=%s", m.cfg.WorkerID)
				m.publishState(context.Background(), "connecting", CodePairingInProgress, WorkerStatusDisponible, "", "", true)
				sendResult(ConnectionState{
					Code:              CodePairingInProgress,
					Status:            "connecting",
					WorkerID:          m.cfg.WorkerID,
					AccountID:         m.cfg.AccountID,
					WorkerTypeID:      WorkerTypeWhatsmeow,
					IsNewLogin:        true,
					Time:              time.Now().Unix(),
					WorkerStatusID:    WorkerStatusDisponible,
					DebugTraceID:      traceID,
					RuntimeGeneration: m.cfg.RuntimeGeneration,
					WarmPoolID:        m.cfg.WarmPoolID,
				})
			case "timeout":
				m.clearLoginArtifacts()
				m.resetQRCodeReadSession(true)
				m.debug.Log(context.Background(), "whatsmeow.provider.qrcode.timeout", map[string]any{
					"trace_id":              traceID,
					"layer":                 "worker_whatsmeow.provider",
					"worker_id":             m.cfg.WorkerID,
					"account_id":            m.cfg.AccountID,
					"worker_type_id":        WorkerTypeWhatsmeow,
					"connection_attempt_id": m.getConnectionAttemptID(),
					"runtime_generation":    m.cfg.RuntimeGeneration,
				})
				log.Printf("whatsmeow qr timeout worker_id=%s", m.cfg.WorkerID)
				m.publishState(context.Background(), "disconnected", CodeConnectionClosed, WorkerStatusDisponible, "", "", true)
				sendResult(ConnectionState{
					Code:              CodeConnectionClosed,
					Status:            "disconnected",
					WorkerID:          m.cfg.WorkerID,
					AccountID:         m.cfg.AccountID,
					WorkerTypeID:      WorkerTypeWhatsmeow,
					IsNewLogin:        true,
					Time:              time.Now().Unix(),
					WorkerStatusID:    WorkerStatusDisponible,
					DebugTraceID:      traceID,
					RuntimeGeneration: m.cfg.RuntimeGeneration,
					WarmPoolID:        m.cfg.WarmPoolID,
				})
			default:
				fields := map[string]any{
					"trace_id":              traceID,
					"layer":                 "worker_whatsmeow.provider",
					"worker_id":             m.cfg.WorkerID,
					"account_id":            m.cfg.AccountID,
					"worker_type_id":        WorkerTypeWhatsmeow,
					"connection_attempt_id": m.getConnectionAttemptID(),
					"runtime_generation":    m.cfg.RuntimeGeneration,
					"event":                 evt.Event,
				}
				if evt.Error != nil {
					fields["error_code"] = safeOperationalErrorCode(evt.Error)
					m.debug.Log(context.Background(), "whatsmeow.provider.qrcode.event_error", fields)
					log.Printf("qr event error worker_id=%s error_code=%s", m.cfg.WorkerID, safeOperationalErrorCode(evt.Error))
				} else {
					m.debug.Log(context.Background(), "whatsmeow.provider.qrcode.unexpected_event", fields)
					log.Printf("whatsmeow qr unexpected event worker_id=%s event=%s", m.cfg.WorkerID, evt.Event)
				}
			}
		}
	}()

	select {
	case state := <-resultCh:
		return state, nil
	case <-qrReadSessionDone:
		return m.currentConnectionState(), nil
	case <-ctx.Done():
		return ConnectionState{}, ctx.Err()
	case <-time.After(m.cfg.ConnectionQRFirstQRTimeout):
		elapsedMS := int(time.Since(qrWaitStartedAt).Milliseconds())
		state := ConnectionState{
			Code:                CodeAwaitingReadQRCode,
			Status:              "connecting",
			WorkerID:            m.cfg.WorkerID,
			AccountID:           m.cfg.AccountID,
			WorkerTypeID:        WorkerTypeWhatsmeow,
			IsNewLogin:          true,
			Time:                time.Now().Unix(),
			WorkerStatusID:      WorkerStatusDisponible,
			QRPending:           true,
			Reason:              "first_qr_timeout",
			TimeToFirstQRMS:     elapsedMS,
			ConnectionAttemptID: m.connectionAttemptID,
			DebugTraceID:        traceID,
			RuntimeGeneration:   m.cfg.RuntimeGeneration,
			WarmPoolID:          m.cfg.WarmPoolID,
		}
		m.debug.Log(context.Background(), "whatsmeow.provider.qrcode.first_qr_timeout", map[string]any{
			"trace_id":              traceID,
			"layer":                 "worker_whatsmeow.provider",
			"worker_id":             m.cfg.WorkerID,
			"account_id":            m.cfg.AccountID,
			"worker_type_id":        WorkerTypeWhatsmeow,
			"connection_attempt_id": m.getConnectionAttemptID(),
			"runtime_generation":    m.cfg.RuntimeGeneration,
			"duration_ms":           elapsedMS,
			"reason":                "first_qr_timeout",
		})
		m.publishState(context.Background(), "connecting", CodeAwaitingReadQRCode, WorkerStatusDisponible, "", "", true)
		return state, nil
	}
}

func (m *WhatsAppManager) connectWithPhonePairing(ctx context.Context, phone string) error {
	return m.connectWithPhonePairingInternal(ctx, phone, true)
}

type phonePairingInvoker func(
	context.Context,
	*whatsmeow.Client,
	string,
) (string, error)

func invokeWhatsmeowPhonePairing(
	ctx context.Context,
	manager *WhatsAppManager,
	client *whatsmeow.Client,
	phone string,
	invoke phonePairingInvoker,
) (string, error) {
	if invoke == nil {
		return "", errors.New("phone pairing invocation is required")
	}
	timeout := time.Duration(0)
	if manager != nil {
		timeout = manager.cfg.SendTimeout
	}
	return invokeWhatsmeowProviderOperationWithDeadline(
		ctx,
		manager,
		client,
		"pair_phone",
		timeout,
		func(invokeCtx context.Context) (string, error) {
			return invoke(invokeCtx, client, phone)
		},
	)
}

func (m *WhatsAppManager) connectWithPhonePairingInternal(ctx context.Context, phone string, allowDeletedStoreRetry bool) error {
	if err := m.rejectLoginDuringProviderHandoff(ctx, "phone_pairing"); err != nil {
		return err
	}
	client, err := m.ensureUsableClientForLogin(ctx, "phone-pairing-request")
	if err != nil {
		m.publishState(ctx, "disconnected", CodeConnectionLost, WorkerStatusDisponible, "", "", false)
		return err
	}
	connectCtx := m.connectionContext()
	if phone = digits(phone); phone == "" {
		return fmt.Errorf("phone_connection is required")
	}
	if m.isAuthenticated(client) {
		log.Printf("whatsmeow phone pairing request already authenticated worker_id=%s", m.cfg.WorkerID)
		m.clearFreshLoginFallback()
		m.clearLoginArtifacts()
		m.publishConnectedWhenReady(ctx, "phone-already-authenticated", phoneFromOwnID(client.Store.ID), false)
		return nil
	}
	if client.IsConnected() && client.Store.ID == nil {
		currentPairingCode := m.getCurrentPairingCode()
		log.Printf("whatsmeow phone pairing request already awaiting pairing worker_id=%s has_pairing_code=%t", m.cfg.WorkerID, currentPairingCode != "")
		m.publishState(ctx, "connecting", CodeAwaitingPairingCode, WorkerStatusDisponible, "", currentPairingCode, true)
		return nil
	}
	if client.IsConnected() && client.Store.ID != nil {
		log.Printf("whatsmeow phone pairing request authentication in progress worker_id=%s", m.cfg.WorkerID)
		m.publishState(ctx, "connecting", CodeAwaitConnection, WorkerStatusDisponible, "", "", false)
		return nil
	}
	if client.Store.ID != nil {
		log.Printf("whatsmeow phone pairing request using stored session worker_id=%s", m.cfg.WorkerID)
		m.armFreshLoginFallback(freshLoginRequest{Type: "phone", Phone: phone})
		if err := m.connectClient(connectCtx, client, "phone-stored-session"); err != nil {
			return m.handleStoredSessionConnectError(ctx, err)
		}
		return nil
	}
	m.clearFreshLoginFallback()
	m.clearLoginArtifacts()
	m.publishState(ctx, "connecting", CodeAwaitingPairingCode, WorkerStatusDisponible, "", "", true)
	if !client.IsConnected() {
		if err := m.connectClient(connectCtx, client, "phone-new-login"); err != nil {
			return m.handleFreshLoginConnectError(ctx, freshLoginRequest{Type: "phone", Phone: phone}, err, allowDeletedStoreRetry)
		}
	}
	pairingCode, err := invokeWhatsmeowPhonePairing(
		ctx,
		m,
		client,
		phone,
		func(
			invokeCtx context.Context,
			invokeClient *whatsmeow.Client,
			invokePhone string,
		) (string, error) {
			return invokeClient.PairPhone(
				invokeCtx,
				invokePhone,
				true,
				whatsmeowPairClientDesktop,
				whatsmeowPairClientDisplayName,
			)
		},
	)
	if err != nil {
		log.Printf("whatsmeow phone pairing failed worker_id=%s error_code=%s", m.cfg.WorkerID, safeOperationalErrorCode(err))
		return m.handleFreshLoginConnectError(ctx, freshLoginRequest{Type: "phone", Phone: phone}, err, allowDeletedStoreRetry)
	}
	m.setCurrentPairingCode(pairingCode)
	m.debug.Log(ctx, "whatsmeow.provider.phone_pairing.generated", map[string]any{
		"trace_id":              m.getDebugTraceID(),
		"layer":                 "worker_whatsmeow.provider",
		"worker_id":             m.cfg.WorkerID,
		"account_id":            m.cfg.AccountID,
		"worker_type_id":        WorkerTypeWhatsmeow,
		"connection_attempt_id": m.getConnectionAttemptID(),
		"runtime_generation":    m.cfg.RuntimeGeneration,
		"has_pairing_code":      pairingCode != "",
		"pairing_code_length":   len(pairingCode),
	})
	log.Printf("whatsmeow phone pairing code generated worker_id=%s", m.cfg.WorkerID)
	m.publishState(ctx, "connecting", CodeAwaitingPairingCode, WorkerStatusDisponible, "", pairingCode, true)
	return nil
}

func (m *WhatsAppManager) removeSession(ctx context.Context) error {
	log.Printf("whatsmeow remove session requested worker_id=%s", m.cfg.WorkerID)
	_ = m.beginFencedProviderLifecycleEvent()
	m.deactivateInboundConnectionScope(ctx)
	if m.cfg.SessionStorage == SessionStoragePostgres {
		fenceCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), workerDatabasePingTimeout)
		err := m.postgres.AssertWhatsmeowSessionWriterFence(fenceCtx, m.cfg)
		cancel()
		if err != nil {
			return fmt.Errorf("authorize postgres session logout: %w", err)
		}
	}
	m.publishState(ctx, "connecting", CodeLogoutInProgress, "", "", "", false)
	m.clearFreshLoginFallback()
	m.clearLoginArtifacts()
	client := m.getClient()
	if client != nil {
		if err := m.logoutAndDeleteDevice(client); err != nil {
			log.Printf("whatsmeow remove session logout failed worker_id=%s error_code=%s", m.cfg.WorkerID, safeOperationalErrorCode(err))
			if errors.Is(err, errOutboundProviderCallStalled) ||
				errors.Is(err, errWhatsmeowProviderClientFenced) ||
				errors.Is(err, errWhatsmeowProviderCallInFlight) {
				// The original SDK flight may still mutate the session. Never
				// overlap Disconnect/store deletion/client recreation with it.
				return fmt.Errorf(
					"remove session provider operation remains uncertain: %w",
					err,
				)
			}
			invalidateWhatsmeowClientCaches(client)
			client.Disconnect()
			if client.Store != nil && client.Store.ID != nil && !client.Store.Deleted {
				if deleteErr := client.Store.Delete(context.Background()); deleteErr != nil {
					return fmt.Errorf("delete local whatsmeow store: %w", deleteErr)
				}
			}
		} else {
			log.Printf("whatsmeow remove session logout sent worker_id=%s", m.cfg.WorkerID)
		}
		m.stopAndPublishNativeConnectionStatus(ctx, client)
	}
	m.mu.Lock()
	m.connected = false
	m.status = "disconnected"
	m.code = CodeLoggedOut
	m.mu.Unlock()

	m.sessionMu.Lock()
	m.closeCurrentWhatsmeowClient()
	if m.cfg.SessionStorage == SessionStoragePostgres {
		clearCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 15*time.Second)
		err := m.postgres.ClearWhatsmeowSession(clearCtx, m.cfg)
		cancel()
		if err != nil {
			m.sessionMu.Unlock()
			return fmt.Errorf("clear postgres whatsmeow session: %w", err)
		}
	}
	if err := m.clearLocalSessionFiles(); err != nil {
		m.sessionMu.Unlock()
		return fmt.Errorf("clear local whatsmeow session files: %w", err)
	}
	m.setAuthStoreDormant(true)
	m.sessionMu.Unlock()
	if m.cfg.SessionStorage == SessionStoragePostgres {
		releaseCtx, releaseCancel := context.WithTimeout(
			context.WithoutCancel(ctx),
			workerDatabaseRecoveryTimeout,
		)
		releaseErr := m.postgres.ReleaseSessionLease(releaseCtx)
		releaseCancel()
		if releaseErr != nil {
			return fmt.Errorf("release WhatsApp session lease after session removal: %w", releaseErr)
		}
	}

	m.publishStateDisconnectedByUser(ctx, CodeLoggedOut, WorkerStatusDisponible)
	return nil
}

func (m *WhatsAppManager) logoutAndDeleteDevice(client *whatsmeow.Client) error {
	if client == nil {
		return nil
	}
	if client.Store == nil || client.Store.ID == nil {
		log.Printf("whatsmeow remove session skipped logout worker_id=%s reason=no_store_id", m.cfg.WorkerID)
		client.Disconnect()
		return nil
	}

	logoutCtx, cancel := context.WithTimeout(context.Background(), whatsmeowLogoutTimeout)
	defer cancel()

	if !client.IsConnected() {
		log.Printf("whatsmeow remove session connecting before logout worker_id=%s", m.cfg.WorkerID)
		if err := m.connectClient(logoutCtx, client, "remove-session-logout"); err != nil {
			return fmt.Errorf("connect before logout: %w", err)
		}
	}

	if _, err := invokeWhatsmeowProviderOperationWithDeadline(
		logoutCtx,
		m,
		client,
		"logout",
		whatsmeowLogoutTimeout,
		func(invokeCtx context.Context) (struct{}, error) {
			return struct{}{}, client.Logout(invokeCtx)
		},
	); err != nil {
		return fmt.Errorf("send remove-companion-device: %w", err)
	}
	return nil
}

func (m *WhatsAppManager) handlePairPasskeyRequestEvent(ctx context.Context, event *events.PairPasskeyRequest, source string) (string, bool) {
	if event == nil || event.PublicKey == nil {
		m.debug.Log(ctx, "whatsmeow.provider.passkey.request_missing", map[string]any{
			"trace_id":              m.getDebugTraceID(),
			"layer":                 "worker_whatsmeow.provider",
			"worker_id":             m.cfg.WorkerID,
			"account_id":            m.cfg.AccountID,
			"worker_type_id":        WorkerTypeWhatsmeow,
			"connection_attempt_id": m.getConnectionAttemptID(),
			"runtime_generation":    m.cfg.RuntimeGeneration,
			"source":                source,
		})
		log.Printf("whatsmeow passkey request missing public key worker_id=%s source=%s", m.cfg.WorkerID, source)
		return "", false
	}

	publicKeyJSON, err := json.Marshal(event.PublicKey)
	if err != nil {
		m.debug.Log(ctx, "whatsmeow.provider.passkey.marshal_error", map[string]any{
			"trace_id":              m.getDebugTraceID(),
			"layer":                 "worker_whatsmeow.provider",
			"worker_id":             m.cfg.WorkerID,
			"account_id":            m.cfg.AccountID,
			"worker_type_id":        WorkerTypeWhatsmeow,
			"connection_attempt_id": m.getConnectionAttemptID(),
			"runtime_generation":    m.cfg.RuntimeGeneration,
			"source":                source,
			"error_code":            safeOperationalErrorCode(err),
		})
		log.Printf("whatsmeow passkey request marshal failed worker_id=%s source=%s error_code=%s", m.cfg.WorkerID, source, safeOperationalErrorCode(err))
		return "", false
	}

	passkeyPublicKey := string(publicKeyJSON)
	m.setCurrentPasskeyRequest(passkeyPublicKey)
	m.debug.Log(ctx, "whatsmeow.provider.passkey.request", map[string]any{
		"trace_id":               m.getDebugTraceID(),
		"layer":                  "worker_whatsmeow.provider",
		"worker_id":              m.cfg.WorkerID,
		"account_id":             m.cfg.AccountID,
		"worker_type_id":         WorkerTypeWhatsmeow,
		"connection_attempt_id":  m.getConnectionAttemptID(),
		"runtime_generation":     m.cfg.RuntimeGeneration,
		"source":                 source,
		"passkey_public_key_len": len(passkeyPublicKey),
	})
	log.Printf(
		"whatsmeow passkey request received worker_id=%s source=%s public_key_len=%d connection_attempt_id=%s",
		m.cfg.WorkerID,
		source,
		len(passkeyPublicKey),
		m.getConnectionAttemptID(),
	)
	connectionFlowLog("whatsmeow.provider.passkey_request.received", map[string]any{
		"trace_id":               m.getDebugTraceID(),
		"layer":                  "worker_whatsmeow.provider",
		"worker_id":              m.cfg.WorkerID,
		"account_id":             m.cfg.AccountID,
		"worker_type_id":         WorkerTypeWhatsmeow,
		"connection_attempt_id":  m.getConnectionAttemptID(),
		"runtime_generation":     m.cfg.RuntimeGeneration,
		"source":                 source,
		"passkey_public_key_len": len(passkeyPublicKey),
	})
	m.publishState(ctx, "connecting", CodeAwaitingPasskey, WorkerStatusDisponible, "", passkeyPublicKey, true)
	return passkeyPublicKey, true
}

func (m *WhatsAppManager) handlePairPasskeyConfirmationEvent(ctx context.Context, event *events.PairPasskeyConfirmation, source string) (string, bool) {
	if event == nil {
		return "", false
	}
	confirmationCode := event.Code
	m.setCurrentPasskeyConfirmation(confirmationCode, event.SkipHandoffUX)
	m.debug.Log(ctx, "whatsmeow.provider.passkey.confirmation", map[string]any{
		"trace_id":                      m.getDebugTraceID(),
		"layer":                         "worker_whatsmeow.provider",
		"worker_id":                     m.cfg.WorkerID,
		"account_id":                    m.cfg.AccountID,
		"worker_type_id":                WorkerTypeWhatsmeow,
		"connection_attempt_id":         m.getConnectionAttemptID(),
		"runtime_generation":            m.cfg.RuntimeGeneration,
		"source":                        source,
		"has_passkey_confirmation_code": confirmationCode != "",
		"passkey_skip_handoff_ux":       event.SkipHandoffUX,
	})
	log.Printf(
		"whatsmeow passkey confirmation received worker_id=%s source=%s has_code=%t skip_handoff_ux=%t connection_attempt_id=%s",
		m.cfg.WorkerID,
		source,
		confirmationCode != "",
		event.SkipHandoffUX,
		m.getConnectionAttemptID(),
	)
	connectionFlowLog("whatsmeow.provider.passkey_confirmation.received", map[string]any{
		"trace_id":                         m.getDebugTraceID(),
		"layer":                            "worker_whatsmeow.provider",
		"worker_id":                        m.cfg.WorkerID,
		"account_id":                       m.cfg.AccountID,
		"worker_type_id":                   WorkerTypeWhatsmeow,
		"connection_attempt_id":            m.getConnectionAttemptID(),
		"runtime_generation":               m.cfg.RuntimeGeneration,
		"source":                           source,
		"has_passkey_confirmation_code":    confirmationCode != "",
		"passkey_confirmation_code_length": len(confirmationCode),
		"passkey_skip_handoff_ux":          event.SkipHandoffUX,
	})
	m.publishState(ctx, "connecting", CodeAwaitingPasskeyConfirmation, WorkerStatusDisponible, "", confirmationCode, true)
	return confirmationCode, true
}

func (m *WhatsAppManager) handleEvent(evt any) {
	m.handleEventFromClient(m.getClient(), evt)
}

func (m *WhatsAppManager) handleEventFromClient(sourceClient *whatsmeow.Client, evt any) {
	if sourceClient == nil || m.getClient() != sourceClient {
		return
	}
	if status, ok := evt.(*events.ConnectionStatus); ok && status != nil {
		m.acceptNativeConnectionStatus(context.Background(), sourceClient, *status, true)
		return
	}
	if m.sourceProviderHandoffInProgress.Load() {
		return
	}
	m.logWhatsmeowEventDebug(context.Background(), evt)
	if m.providerHandoffSnapshotResyncPending.Load() {
		switch evt.(type) {
		case *events.Message, *events.HistorySync, *events.Receipt,
			*events.CallOffer, *events.CallOfferNotice, *events.ChatPresence:
			logWhatsappSessionDebug(
				m.cfg.WhatsappSessionDebugEnabled,
				"handoff_app_state_snapshot_resync_runtime_event_suppressed",
				map[string]any{
					"session_id": m.cfg.WorkerID,
					"provider":   "whatsmeow",
					"stage":      "validating",
					"event_type": fmt.Sprintf("%T", evt),
				},
			)
			return
		}
	}

	switch event := evt.(type) {
	case *events.PairPasskeyRequest:
		m.handlePairPasskeyRequestEvent(context.Background(), event, "event-handler")
	case *events.PairPasskeyConfirmation:
		if event.SkipHandoffUX {
			log.Printf("whatsmeow passkey confirmation skipped by handoff UX worker_id=%s source=event-handler", m.cfg.WorkerID)
			return
		}
		m.handlePairPasskeyConfirmationEvent(context.Background(), event, "event-handler")
	case *events.PairPasskeyError:
		log.Printf("whatsmeow passkey error worker_id=%s continuation=%t error_code=%s", m.cfg.WorkerID, event.Continuation, safeOperationalErrorCode(event.Error))
	case *events.AppStateSyncComplete:
		m.handleProviderHandoffAppStateSyncComplete(
			string(event.Name), event.Version,
		)
	case *events.AppStateSyncError:
		stage := m.providerHandoffStage.Load()
		name := string(event.Name)
		if event.FullSync && stage != nil &&
			m.providerHandoffSnapshotResyncPending.Load() &&
			stage.AppStateSnapshotResyncRequired &&
			stringSliceContains(stage.AppStateSnapshotResyncCollections, name) {
			m.scheduleProviderHandoffAppStateSnapshotResyncFailure(
				stage, name, event.Error,
			)
		}
	case *events.Connected:
		if m.isProviderProcessQuarantined() {
			log.Printf(
				"whatsmeow connected event rejected for quarantined process worker_id=%s",
				m.cfg.WorkerID,
			)
			return
		}
		lifecycleEvent := m.beginProviderLifecycleEvent(false)
		log.Printf("whatsmeow event connected worker_id=%s", m.cfg.WorkerID)
		scope, err := m.rotateVerifiedInboundConnectionScopeWithTimeout(
			m.connectionContext(),
			sourceClient,
			"connected-event",
		)
		if err != nil {
			log.Printf(
				"whatsmeow runtime fence activation failed worker_id=%s generation=%d error_code=%s",
				m.cfg.WorkerID,
				m.cfg.RuntimeGeneration,
				safeOperationalErrorCode(err),
			)
			if !m.applyProviderLifecycleState(lifecycleEvent.serial, func() {
				m.connected = false
				m.status = "connecting"
				m.code = CodeAwaitConnection
				m.degradedReason = "runtime_fence_activation_failed"
			}) {
				return
			}
			m.publishState(
				context.Background(),
				"connecting",
				CodeAwaitConnection,
				WorkerStatusDisponible,
				"",
				"",
				false,
			)
			m.scheduleRuntimeFenceRecovery(
				sourceClient,
				"connected-event",
				lifecycleEvent.serial,
			)
			return
		}
		if !m.applyProviderLifecycleState(lifecycleEvent.serial, func() {
			m.connected = true
			m.status = "connected"
			m.code = CodeConnectionEstablished
			m.lastKeepAliveAt = time.Now()
			m.keepAliveFailures = 0
			m.consecutiveSendFailures = 0
			m.degradedReason = ""
		}) {
			m.deactivateCapturedInboundConnectionScopeAsync(&scope)
			return
		}
		localConnectionStatusLog("whatsmeow.event.connected", map[string]any{
			"layer":              "worker_whatsmeow.event",
			"provider":           "whatsmeow",
			"worker_id":          m.cfg.WorkerID,
			"account_id":         m.cfg.AccountID,
			"worker_type_id":     WorkerTypeWhatsmeow,
			"status":             "connected",
			"code":               CodeConnectionEstablished,
			"runtime_generation": m.cfg.RuntimeGeneration,
			"connection_epoch":   scope.ConnectionEpoch,
		})
		m.clearFreshLoginFallback()
		m.clearLoginArtifacts()
		client := m.getClient()
		phone := ""
		if client != nil {
			phone = phoneFromOwnID(client.Store.ID)
		}
		go m.publishConnectedWhenReadyForScope(
			context.Background(),
			scope,
			"connected-event",
			phone,
			false,
		)
	case *events.Disconnected:
		lifecycleEvent := m.beginFencedProviderLifecycleEvent()
		log.Printf("whatsmeow event disconnected worker_id=%s", m.cfg.WorkerID)
		localConnectionStatusLog("whatsmeow.event.disconnected", map[string]any{
			"layer":              "worker_whatsmeow.event",
			"provider":           "whatsmeow",
			"worker_id":          m.cfg.WorkerID,
			"account_id":         m.cfg.AccountID,
			"worker_type_id":     WorkerTypeWhatsmeow,
			"status":             "connecting",
			"code":               CodeAwaitConnection,
			"worker_status_id":   WorkerStatusDisponible,
			"reason":             "disconnected_event",
			"runtime_generation": m.cfg.RuntimeGeneration,
		})
		m.clearLoginArtifacts()
		if !m.applyProviderLifecycleState(lifecycleEvent.serial, func() {
			m.connected = false
			m.status = "connecting"
			m.code = CodeAwaitConnection
			m.degradedReason = "disconnected_event"
		}) {
			return
		}
		m.scheduleTransientDisconnectPublication(lifecycleEvent.serial)
		if lifecycleEvent.capturedScope != nil {
			m.deactivateCapturedInboundConnectionScopeAsync(
				lifecycleEvent.capturedScope,
			)
		}
		if !m.isProviderLifecycleEventCurrent(lifecycleEvent.serial) {
			return
		}
		if m.isQRCodeReadSessionLocked() {
			log.Printf("whatsmeow disconnected event ignored after qr limit worker_id=%s", m.cfg.WorkerID)
		}
	case *events.LoggedOut:
		lifecycleEvent := m.beginFencedProviderLifecycleEvent()
		log.Printf("whatsmeow event logged_out worker_id=%s on_connect=%t reason=%s", m.cfg.WorkerID, event.OnConnect, event.Reason.String())
		if lifecycleEvent.capturedScope != nil {
			m.deactivateCapturedInboundConnectionScopeAsync(
				lifecycleEvent.capturedScope,
			)
		}
		if !m.isProviderLifecycleEventCurrent(lifecycleEvent.serial) {
			return
		}
		localConnectionStatusLog("whatsmeow.event.logged_out", map[string]any{
			"layer":              "worker_whatsmeow.event",
			"provider":           "whatsmeow",
			"worker_id":          m.cfg.WorkerID,
			"account_id":         m.cfg.AccountID,
			"worker_type_id":     WorkerTypeWhatsmeow,
			"status":             "disconnected",
			"code":               CodeLoggedOut,
			"worker_status_id":   WorkerStatusMismatched,
			"reason":             event.Reason.String(),
			"on_connect":         event.OnConnect,
			"runtime_generation": m.cfg.RuntimeGeneration,
		})
		m.clearLoginArtifacts()
		if m.startFreshLoginAfterStoredSessionLogout() {
			return
		}
		if err := m.clearPostgresSessionAfterProviderLogout(context.Background()); err != nil {
			log.Printf("whatsmeow provider logout postgres session cleanup failed worker_id=%s error_code=%s", m.cfg.WorkerID, safeOperationalErrorCode(err))
		}
		if !m.applyProviderLifecycleState(lifecycleEvent.serial, func() {
			m.connected = false
			m.status = "disconnected"
			m.code = CodeLoggedOut
			m.degradedReason = "logged_out"
		}) {
			return
		}
		if !m.isProviderLifecycleEventCurrent(lifecycleEvent.serial) {
			return
		}
		m.publishStateDisconnectedByUser(context.Background(), CodeLoggedOut, WorkerStatusMismatched)
	case *events.ConnectFailure:
		lifecycleEvent := m.beginFencedProviderLifecycleEvent()
		log.Printf("whatsmeow event connect_failure worker_id=%s reason=%s message_bytes=%d", m.cfg.WorkerID, event.Reason.String(), len([]byte(event.Message)))
		if lifecycleEvent.capturedScope != nil {
			m.deactivateCapturedInboundConnectionScopeAsync(
				lifecycleEvent.capturedScope,
			)
		}
		if !m.isProviderLifecycleEventCurrent(lifecycleEvent.serial) {
			return
		}
		localConnectionStatusLog("whatsmeow.event.connect_failure", map[string]any{
			"layer":              "worker_whatsmeow.event",
			"provider":           "whatsmeow",
			"worker_id":          m.cfg.WorkerID,
			"account_id":         m.cfg.AccountID,
			"worker_type_id":     WorkerTypeWhatsmeow,
			"status":             "connecting",
			"code":               CodeAwaitConnection,
			"worker_status_id":   WorkerStatusDisponible,
			"reason":             event.Reason.String(),
			"message":            event.Message,
			"runtime_generation": m.cfg.RuntimeGeneration,
		})
		m.clearLoginArtifacts()
		if event.Reason.IsLoggedOut() {
			if !m.applyProviderLifecycleState(lifecycleEvent.serial, func() {
				m.connected = false
				m.status = "disconnected"
				m.code = CodeLoggedOut
				m.degradedReason = "logged_out"
			}) {
				return
			}
			if m.startFreshLoginAfterStoredSessionLogout() {
				return
			}
			m.clearFreshLoginFallback()
			if !m.isProviderLifecycleEventCurrent(lifecycleEvent.serial) {
				return
			}
			m.publishStateDisconnectedByUser(context.Background(), CodeLoggedOut, WorkerStatusMismatched)
			return
		}
		m.clearFreshLoginFallback()
		if !m.applyProviderLifecycleState(lifecycleEvent.serial, func() {
			m.connected = false
			m.status = "connecting"
			m.code = CodeAwaitConnection
			m.degradedReason = "connect_failure"
		}) {
			return
		}
		if !m.isProviderLifecycleEventCurrent(lifecycleEvent.serial) {
			return
		}
		m.publishState(context.Background(), "connecting", CodeAwaitConnection, WorkerStatusDisponible, "", "", false)
	case *events.StreamReplaced:
		lifecycleEvent := m.beginFencedProviderLifecycleEvent()
		log.Printf("whatsmeow event stream_replaced worker_id=%s", m.cfg.WorkerID)
		if lifecycleEvent.capturedScope != nil {
			m.deactivateCapturedInboundConnectionScopeAsync(
				lifecycleEvent.capturedScope,
			)
		}
		if !m.isProviderLifecycleEventCurrent(lifecycleEvent.serial) {
			return
		}
		localConnectionStatusLog("whatsmeow.event.stream_replaced", map[string]any{
			"layer":              "worker_whatsmeow.event",
			"provider":           "whatsmeow",
			"worker_id":          m.cfg.WorkerID,
			"account_id":         m.cfg.AccountID,
			"worker_type_id":     WorkerTypeWhatsmeow,
			"status":             "disconnected",
			"code":               CodeConnectionReplaced,
			"worker_status_id":   WorkerStatusMismatched,
			"reason":             "stream_replaced",
			"runtime_generation": m.cfg.RuntimeGeneration,
		})
		m.clearLoginArtifacts()
		m.clearFreshLoginFallback()
		if !m.applyProviderLifecycleState(lifecycleEvent.serial, func() {
			m.connected = false
			m.status = "disconnected"
			m.code = CodeConnectionReplaced
			m.degradedReason = "stream_replaced"
		}) {
			return
		}
		if !m.isProviderLifecycleEventCurrent(lifecycleEvent.serial) {
			return
		}
		m.publishState(context.Background(), "disconnected", CodeConnectionReplaced, WorkerStatusMismatched, "", "", false)
	case *events.KeepAliveTimeout:
		m.recordKeepAliveTimeout(context.Background(), event)
	case *events.KeepAliveRestored:
		m.recordKeepAliveRestored(context.Background())
	case *events.Message:
		scope, ok := m.currentInboundConnectionScope()
		if !ok {
			return
		}
		m.logIncomingMessageSummary(event, incomingSkipReason(event))
		go m.handleIncomingMessage(withInboundConnectionScope(context.Background(), scope), event)
	case *events.HistorySync:
		scope, ok := m.currentInboundConnectionScope()
		if !ok {
			return
		}
		// History enrichment is attached to the worker runtime so shutdown is
		// cancelable. Keep at most one running snapshot and one coalesced latest
		// snapshot; a reconnect burst must not retain an unbounded number of large
		// protobuf trees in waiting goroutines.
		m.scheduleHistorySync(withInboundConnectionScope(m.connectionContext(), scope), event)
	case *events.Receipt:
		scope, ok := m.currentInboundConnectionScope()
		if !ok {
			return
		}
		go m.handleReceipt(withInboundConnectionScope(context.Background(), scope), event)
	case *events.CallOffer:
		scope, ok := m.currentInboundConnectionScope()
		if !ok {
			return
		}
		go m.handleCallOffer(withInboundConnectionScope(context.Background(), scope), event.From, event.CallID, event.CallCreator, strings.EqualFold(event.RemotePlatform, "video"))
	case *events.CallOfferNotice:
		scope, ok := m.currentInboundConnectionScope()
		if !ok {
			return
		}
		go m.handleCallOffer(withInboundConnectionScope(context.Background(), scope), event.From, event.CallID, event.CallCreator, event.Media == "video")
	case *events.ChatPresence:
		scope, ok := m.currentInboundConnectionScope()
		if !ok {
			return
		}
		go m.publishPresence(withInboundConnectionScope(context.Background(), scope), event)
	}
}

func (m *WhatsAppManager) handleStoredSessionConnectError(ctx context.Context, err error) error {
	if isStoredSessionInvalidError(err) {
		req, ok := m.consumeFreshLoginFallback()
		if ok {
			log.Printf("whatsmeow stored session invalid, restarting fresh login worker_id=%s type=%s error_code=%s", m.cfg.WorkerID, req.Type, safeOperationalErrorCode(err))
			return m.resetAndStartFreshLogin(ctx, req)
		}
	}
	m.clearFreshLoginFallback()
	return err
}

func (m *WhatsAppManager) handleFreshLoginConnectError(ctx context.Context, req freshLoginRequest, err error, allowDeletedStoreRetry bool) error {
	if allowDeletedStoreRetry && isStoredSessionInvalidError(err) {
		log.Printf("whatsmeow fresh login found invalid local session, resetting worker_id=%s type=%s error_code=%s", m.cfg.WorkerID, req.Type, safeOperationalErrorCode(err))
		m.publishState(ctx, "connecting", CodeAwaitConnection, WorkerStatusDisponible, "", "", true)
		if resetErr := m.resetLocalSession(ctx); resetErr != nil {
			log.Printf("whatsmeow fresh login reset failed worker_id=%s error_code=%s", m.cfg.WorkerID, safeOperationalErrorCode(resetErr))
			m.publishState(ctx, "disconnected", CodeConnectionLost, WorkerStatusDisponible, "", "", false)
			return fmt.Errorf("reset invalid whatsmeow session: %w", resetErr)
		}

		_, err := m.connectWithQRCodeInternal(ctx, false)
		return err
	}

	m.clearLoginArtifacts()
	m.clearFreshLoginFallback()
	m.publishState(ctx, "disconnected", CodeConnectionLost, WorkerStatusDisponible, "", "", false)
	return err
}

func (m *WhatsAppManager) armFreshLoginFallback(req freshLoginRequest) {
	if req.Type == "" {
		req.Type = "qrcode"
	}
	m.mu.Lock()
	m.pendingFreshLogin = &req
	m.mu.Unlock()
}

func (m *WhatsAppManager) clearFreshLoginFallback() {
	m.mu.Lock()
	m.pendingFreshLogin = nil
	m.mu.Unlock()
}

func (m *WhatsAppManager) consumeFreshLoginFallback() (freshLoginRequest, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.pendingFreshLogin == nil {
		return freshLoginRequest{}, false
	}
	req := *m.pendingFreshLogin
	m.pendingFreshLogin = nil
	return req, true
}

func (m *WhatsAppManager) startFreshLoginAfterStoredSessionLogout() bool {
	req, ok := m.consumeFreshLoginFallback()
	if !ok {
		return false
	}
	log.Printf("whatsmeow stored session logout fallback triggered worker_id=%s type=%s", m.cfg.WorkerID, req.Type)
	go func() {
		if err := m.resetAndStartFreshLogin(context.Background(), req); err != nil {
			log.Printf("failed to restart whatsmeow fresh login after stale session logout worker_id=%s error_code=%s", m.cfg.WorkerID, safeOperationalErrorCode(err))
			m.publishState(context.Background(), "disconnected", CodeLoggedOut, WorkerStatusMismatched, "", "", false)
		}
	}()
	return true
}

func (m *WhatsAppManager) resetAndStartFreshLogin(ctx context.Context, req freshLoginRequest) error {
	log.Printf("whatsmeow reset and start fresh login worker_id=%s type=%s", m.cfg.WorkerID, req.Type)
	m.publishState(ctx, "connecting", CodeAwaitConnection, WorkerStatusDisponible, "", "", true)
	if err := m.resetLocalSession(ctx); err != nil {
		return err
	}
	_, err := m.connectWithQRCode(ctx)
	return err
}

func (m *WhatsAppManager) resetLocalSession(ctx context.Context) error {
	m.sessionMu.Lock()
	defer m.sessionMu.Unlock()
	_ = m.beginFencedProviderLifecycleEvent()

	m.inboundFenceMu.Lock()
	defer m.inboundFenceMu.Unlock()
	m.mu.RLock()
	var previousScope whatsAppRuntimeFence
	if m.inboundConnectionScope != nil {
		previousScope = *m.inboundConnectionScope
	}
	var connectionAttemptID string
	if m.ownedRuntimeConnectionFence != nil &&
		m.ownedRuntimeConnectionFence.ConnectionEpoch == previousScope.ConnectionEpoch {
		connectionAttemptID = m.ownedRuntimeConnectionFence.ConnectionAttemptID
	}
	m.mu.RUnlock()
	if !previousScope.isValid() {
		return errors.New("active runtime connection fence is required before resetting the WhatsApp auth store")
	}
	detached, ok := m.detachCapturedInboundConnectionScopeLocal(&previousScope)
	if !ok {
		return errWhatsAppRuntimeFenceRevoked
	}
	m.cleanupDetachedInboundConnectionScope(ctx, detached)

	client := m.getClient()
	if client != nil {
		invalidateWhatsmeowClientCaches(client)
		m.stopAndPublishNativeConnectionStatus(ctx, client)
		if m.cfg.SessionStorage != SessionStoragePostgres && client.Store != nil && client.Store.ID != nil && !client.Store.Deleted {
			log.Printf("whatsmeow deleting stale local store worker_id=%s", m.cfg.WorkerID)
			if err := client.Store.Delete(ctx); err != nil {
				log.Printf("whatsmeow stale local store delete failed worker_id=%s error_code=%s", m.cfg.WorkerID, safeOperationalErrorCode(err))
			}
		}
	}
	m.closeCurrentWhatsmeowClient()
	if m.cfg.SessionStorage == SessionStoragePostgres {
		clearCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 15*time.Second)
		err := m.postgres.ClearWhatsmeowSession(clearCtx, m.cfg)
		cancel()
		if err != nil {
			return fmt.Errorf("clear postgres whatsmeow session: %w", err)
		}
	}

	if err := m.clearLocalSessionFiles(); err != nil {
		return fmt.Errorf("clear whatsmeow local session files: %w", err)
	}

	m.mu.Lock()
	m.connected = false
	m.status = "connecting"
	m.code = CodeAwaitConnection
	m.mu.Unlock()
	activationCtx, activationCancel := m.runtimeFenceActivationContext(ctx)
	reactivatedScope, activationErr := m.rotateInboundConnectionScopeWithIdentity(
		activationCtx,
		previousScope.ConnectionEpoch,
		connectionAttemptID,
	)
	activationCancel()
	if activationErr != nil {
		m.setAuthStoreDormant(true)
		return fmt.Errorf("reactivate WhatsApp runtime fence before auth-store reset: %w", activationErr)
	}
	if err := m.verifyAuthStoreRuntimeFence(ctx, reactivatedScope); err != nil {
		m.setAuthStoreDormant(true)
		return fmt.Errorf("verify reactivated WhatsApp runtime fence before auth-store reset: %w", err)
	}
	if err := m.initializeAuthStore(ctx); err != nil {
		m.setAuthStoreDormant(true)
		return err
	}
	m.setAuthStoreDormant(false)
	return nil
}

func (m *WhatsAppManager) clearPostgresSessionAfterProviderLogout(ctx context.Context) error {
	if m.cfg.SessionStorage != SessionStoragePostgres {
		return nil
	}
	m.sessionMu.Lock()
	defer m.sessionMu.Unlock()
	clearCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 15*time.Second)
	defer cancel()
	if err := m.postgres.ClearWhatsmeowSession(clearCtx, m.cfg); err != nil {
		return fmt.Errorf("clear postgres whatsmeow session after provider logout: %w", err)
	}
	return nil
}

func isStoredSessionInvalidError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "logged out") ||
		strings.Contains(msg, "deleted device") ||
		strings.Contains(msg, "invalid use of deleted device") ||
		strings.Contains(msg, "primary device was logged out")
}

func (m *WhatsAppManager) setState(status string, code int, workerStatusID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.status = status
	m.code = code
}

func (m *WhatsAppManager) persistWorkerStatus(ctx context.Context, state ConnectionState) error {
	m.attachNativeConnectionStatus(&state)
	strongOnline := state.WorkerStatusID == WorkerStatusOnline &&
		state.SessionReady && state.CanSend && state.CanReceiveRuntime && state.Authenticated
	if strongOnline && m.sourceProviderHandoffInProgress.Load() {
		return wrapSafeOperationalError(
			safeCodeHandoffSourceScopeFailed,
			errors.New("whatsmeow provider handoff fenced delayed online persistence"),
		)
	}
	if strongOnline {
		status := state.ConnectionStatus
		if state.ConnectionStatusSourceID == "" || status == nil ||
			status.Status != string(events.ConnectionStatusOnline) ||
			!status.Connected || !status.Authenticated || status.SessionValid == nil ||
			!*status.SessionValid || status.QRAvailable {
			return errors.New("whatsmeow online native connection status is unavailable")
		}
	}
	if m.cfg.SessionStorage == SessionStoragePostgres && strongOnline {
		proof, ok := m.postgres.ConnectionStatusLeaseProof()
		if !ok {
			return errors.New("whatsmeow online connection status lease proof is unavailable")
		}
		if m.persistNativeConnectionStatus == nil {
			return errors.New("native connection status database writer is not configured")
		}
		statusSequence := uint64(0)
		if state.ConnectionStatus != nil {
			statusSequence = state.ConnectionStatus.Sequence
		}
		logWhatsappSessionDebug(m.cfg.WhatsappSessionDebugEnabled, "strong_online.persistence_started", map[string]any{
			"trace_id":            state.DebugTraceID,
			"session_id":          m.cfg.WorkerID,
			"provider":            "whatsmeow",
			"runtime_generation":  m.cfg.RuntimeGeneration,
			"sequence":            statusSequence,
			"session_ready":       state.SessionReady,
			"can_send":            state.CanSend,
			"can_receive_runtime": state.CanReceiveRuntime,
			"authenticated":       state.Authenticated,
			"fencing_token":       proof.FencingToken,
		})
		startedAt := time.Now()
		err := m.persistNativeConnectionStatus(ctx, state, uuid.NewString(), &proof)
		logWhatsappSessionDebug(m.cfg.WhatsappSessionDebugEnabled, "strong_online.persistence_completed", map[string]any{
			"trace_id":           state.DebugTraceID,
			"session_id":         m.cfg.WorkerID,
			"provider":           "whatsmeow",
			"runtime_generation": m.cfg.RuntimeGeneration,
			"sequence":           statusSequence,
			"duration_ms":        time.Since(startedAt).Milliseconds(),
			"successful":         err == nil,
			"error_code":         safeOperationalErrorCode(err),
		})
		return err
	}
	if m.notifyWorkerStatus != nil {
		if err := m.notifyWorkerStatus(ctx, state); err != nil {
			return err
		}
		return m.persistAttemptCredentialTelemetry(ctx, state)
	}
	return errors.New("worker status database writer is not configured")
}

func (m *WhatsAppManager) persistAttemptCredentialTelemetry(ctx context.Context, state ConnectionState) error {
	if m.notifyWorkerStatus == nil || strings.TrimSpace(state.ConnectionAttemptID) == "" ||
		(state.QRCode == "" && state.PairingCode == "" && state.PasskeyPublicKey == "" && state.PasskeyConfirmationCode == "") {
		return nil
	}

	// Credential rotations are progress inside one durable worker status. The
	// native snapshot can legitimately keep the same source and sequence, so a
	// second telemetry event carries the new secret to the outbox without
	// competing with worker.worker_status_id or the native-status projection.
	credential := state
	credential.EventType = "telemetry"
	credential.WorkerStatusID = ""
	credential.DisconnectedUser = false
	credential.RequiresConnectionFence = false
	credential.ConnectionStatus = nil
	credential.ConnectionStatusSourceID = ""
	return m.notifyWorkerStatus(ctx, credential)
}

func (m *WhatsAppManager) rejectOnlineAuthorization(state *ConnectionState, reason string) {
	if state == nil {
		return
	}
	m.invalidateConsumerBarrier()
	m.mu.Lock()
	m.status = "connecting"
	m.code = CodeAwaitConnection
	m.degradedReason = reason
	m.mu.Unlock()
	state.Status = "connecting"
	state.Code = CodeAwaitConnection
	state.WorkerStatusID = WorkerStatusDisponible
	state.SessionReady = false
	state.CanSend = false
	state.CanReceiveRuntime = false
	state.ProviderState = "worker_status_not_published"
	state.DegradedReason = reason
	state.Reason = reason
}

// rejectTransientOnlineAuthorization downgrades only the publication attempt.
// The provider session and all positioned Kafka readers remain intact. The
// supervisor keeps dispatch fail-closed and retries the central ONLINE ACK.
func (m *WhatsAppManager) rejectTransientOnlineAuthorization(state *ConnectionState, reason string) {
	if state == nil {
		return
	}
	state.Status = "connecting"
	state.Code = CodeAwaitConnection
	state.WorkerStatusID = WorkerStatusDisponible
	state.SessionReady = false
	state.CanSend = false
	state.CanReceiveRuntime = false
	state.ProviderState = "worker_status_not_published"
	state.DegradedReason = reason
	state.Reason = reason
}

func (m *WhatsAppManager) authorizeOnlineState(ctx context.Context, state *ConnectionState) bool {
	if state == nil || state.WorkerStatusID != WorkerStatusOnline {
		return false
	}
	if scope, ok := inboundConnectionScopeFromContext(ctx); ok {
		if err := m.assertCapturedConnectionScope(ctx, scope); err != nil {
			m.rejectOnlineAuthorization(state, "runtime_fence_revoked")
			return false
		}
	}
	if err := m.persistWorkerStatus(ctx, *state); err != nil {
		localConnectionStatusLog("whatsmeow.provider.online_authorization.error", map[string]any{
			"layer":                 "worker_whatsmeow.provider",
			"provider":              "whatsmeow",
			"worker_id":             state.WorkerID,
			"account_id":            state.AccountID,
			"worker_type_id":        state.WorkerTypeID,
			"worker_status_id":      state.WorkerStatusID,
			"connection_attempt_id": state.ConnectionAttemptID,
			"runtime_generation":    state.RuntimeGeneration,
			"reason":                safeOperationalErrorCode(err),
		})
		m.rejectTransientOnlineAuthorization(state, "notify_worker_status_failed")
		return false
	}

	if scope, ok := inboundConnectionScopeFromContext(ctx); ok {
		if err := m.assertCapturedConnectionScope(ctx, scope); err != nil {
			m.rejectOnlineAuthorization(state, "runtime_fence_revoked")
			_ = m.persistWorkerStatus(ctx, *state)
			return false
		}
	}

	// A rebalance may have started while the PostgreSQL status CAS was running.
	// Never expose online if that positioned generation is gone.
	m.enrichReadiness(state)
	if state.WorkerStatusID != WorkerStatusOnline {
		_ = m.persistWorkerStatus(ctx, *state)
		return false
	}
	return true
}

func (m *WhatsAppManager) publishState(ctx context.Context, status string, code int, workerStatusID, phone, qrOrPair string, isNewLogin bool) bool {
	return m.publishStateWithAttempts(ctx, status, code, workerStatusID, phone, qrOrPair, isNewLogin, 0, 0)
}

func (m *WhatsAppManager) publishStateWithAttempts(ctx context.Context, status string, code int, workerStatusID, phone, qrOrPair string, isNewLogin bool, attempt int, maxAttempts int) bool {
	return m.publishStateWithAttemptMetadata(ctx, status, code, workerStatusID, phone, qrOrPair, isNewLogin, attempt, maxAttempts, "", 0)
}

func (m *WhatsAppManager) publishStateWithAttemptMetadata(ctx context.Context, status string, code int, workerStatusID, phone, qrOrPair string, isNewLogin bool, attempt int, maxAttempts int, qrGeneratedAt string, timeToFirstQRMS int) bool {
	return m.publishStateWithAttemptMetadataInternal(ctx, status, code, workerStatusID, phone, qrOrPair, isNewLogin, attempt, maxAttempts, qrGeneratedAt, timeToFirstQRMS, true)
}

func (m *WhatsAppManager) publishStatePreservingConsumerBarrier(ctx context.Context, status string, code int, workerStatusID, phone, qrOrPair string, isNewLogin bool) bool {
	return m.publishStateWithAttemptMetadataInternal(ctx, status, code, workerStatusID, phone, qrOrPair, isNewLogin, 0, 0, "", 0, false)
}

func (m *WhatsAppManager) attachRuntimeFenceToConnectionState(ctx context.Context, state *ConnectionState) {
	if state == nil {
		return
	}
	state.SourceProvider = "whatsmeow"
	state.EventType = "status"
	m.attachNativeConnectionStatus(state)
	state.RequiresConnectionFence = state.WorkerStatusID == WorkerStatusOnline
	scope, ok := inboundConnectionScopeFromContext(ctx)
	if !ok {
		scope, ok = m.currentInboundConnectionScope()
	}
	if !ok {
		return
	}
	state.ConnectionEpoch = scope.ConnectionEpoch
	state.ConnectionSequence = scope.ConnectionSequence
}

func (m *WhatsAppManager) publishStateWithAttemptMetadataInternal(ctx context.Context, status string, code int, workerStatusID, phone, qrOrPair string, isNewLogin bool, attempt int, maxAttempts int, qrGeneratedAt string, timeToFirstQRMS int, invalidateBarrier bool) bool {
	onlineRequested := workerStatusID == WorkerStatusOnline && status == "connected" && code == CodeConnectionEstablished
	state := ConnectionState{
		Code:                code,
		Status:              status,
		WorkerID:            m.cfg.WorkerID,
		AccountID:           m.cfg.AccountID,
		WorkerTypeID:        WorkerTypeWhatsmeow,
		IsNewLogin:          isNewLogin,
		Time:                time.Now().Unix(),
		Phone:               phone,
		WorkerStatusID:      workerStatusID,
		ConnectionAttemptID: m.getConnectionAttemptID(),
		DebugTraceID:        m.getDebugTraceID(),
		RuntimeGeneration:   m.cfg.RuntimeGeneration,
		WarmPoolID:          m.cfg.WarmPoolID,
		QRGeneratedAt:       qrGeneratedAt,
		TimeToFirstQRMS:     timeToFirstQRMS,
	}
	if attempt > 0 {
		state.Attempt = attempt
	}
	if maxAttempts > 0 {
		state.MaxAttempts = maxAttempts
	}
	if code == CodeAwaitingReadQRCode {
		state.QRCode = qrOrPair
	}
	if code == CodeAwaitingPairingCode {
		state.PairingCode = qrOrPair
	}
	if code == CodeAwaitingPasskey {
		state.PasskeyPublicKey = qrOrPair
		state.PasskeyPending = qrOrPair != ""
	}
	if code == CodeAwaitingPasskeyConfirmation {
		state.PasskeyConfirmationCode = qrOrPair
		state.PasskeyPending = false
	}
	m.attachRuntimeFenceToConnectionState(ctx, &state)
	m.enrichReadiness(&state)
	if invalidateBarrier && (state.WorkerStatusID != WorkerStatusOnline || state.Status != "connected" || state.Code != CodeConnectionEstablished) {
		// Close the gate synchronously with the provider transition. A rapid
		// reconnect must not reuse readers from the previous provider session;
		// the supervisor will close them and position all seven again.
		m.invalidateConsumerBarrier()
	}
	localConnectionStatusLog("whatsmeow.provider.publish_state", map[string]any{
		"layer":                         "worker_whatsmeow.provider",
		"provider":                      "whatsmeow",
		"worker_id":                     state.WorkerID,
		"account_id":                    state.AccountID,
		"worker_type_id":                state.WorkerTypeID,
		"worker_status_id":              state.WorkerStatusID,
		"status":                        state.Status,
		"code":                          state.Code,
		"session_ready":                 state.SessionReady,
		"can_send":                      state.CanSend,
		"can_receive_runtime":           state.CanReceiveRuntime,
		"authenticated":                 state.Authenticated,
		"provider_state":                state.ProviderState,
		"degraded_reason":               state.DegradedReason,
		"reason":                        state.Reason,
		"phone":                         state.Phone,
		"connection_attempt_id":         state.ConnectionAttemptID,
		"runtime_generation":            state.RuntimeGeneration,
		"has_qr":                        state.QRCode != "",
		"qr_length":                     len(state.QRCode),
		"has_pairing_code":              state.PairingCode != "",
		"pairing_code_length":           len(state.PairingCode),
		"has_passkey_public_key":        state.PasskeyPublicKey != "",
		"passkey_public_key_len":        len(state.PasskeyPublicKey),
		"has_passkey_confirmation_code": state.PasskeyConfirmationCode != "",
		"passkey_skip_handoff_ux":       state.PasskeySkipHandoffUX,
		"is_new_login":                  isNewLogin,
		"attempt":                       state.Attempt,
		"max_attempts":                  state.MaxAttempts,
	})
	connectionFlowLog("whatsmeow.provider.publish_state", map[string]any{
		"trace_id":                         state.DebugTraceID,
		"layer":                            "worker_whatsmeow.provider",
		"provider":                         "whatsmeow",
		"worker_id":                        state.WorkerID,
		"account_id":                       state.AccountID,
		"worker_type_id":                   state.WorkerTypeID,
		"worker_status_id":                 state.WorkerStatusID,
		"status":                           state.Status,
		"code":                             state.Code,
		"session_ready":                    state.SessionReady,
		"can_send":                         state.CanSend,
		"can_receive_runtime":              state.CanReceiveRuntime,
		"authenticated":                    state.Authenticated,
		"provider_state":                   state.ProviderState,
		"degraded_reason":                  state.DegradedReason,
		"reason":                           state.Reason,
		"phone":                            state.Phone,
		"connection_attempt_id":            state.ConnectionAttemptID,
		"runtime_generation":               state.RuntimeGeneration,
		"has_qr":                           state.QRCode != "",
		"qr_length":                        len(state.QRCode),
		"has_pairing_code":                 state.PairingCode != "",
		"pairing_code_length":              len(state.PairingCode),
		"has_passkey_public_key":           state.PasskeyPublicKey != "",
		"passkey_public_key_length":        len(state.PasskeyPublicKey),
		"has_passkey_confirmation_code":    state.PasskeyConfirmationCode != "",
		"passkey_confirmation_code_length": len(state.PasskeyConfirmationCode),
		"passkey_skip_handoff_ux":          state.PasskeySkipHandoffUX,
		"is_new_login":                     isNewLogin,
		"attempt":                          state.Attempt,
		"max_attempts":                     state.MaxAttempts,
		"qr_generated_at":                  state.QRGeneratedAt,
		"time_to_first_qr_ms":              state.TimeToFirstQRMS,
	})
	log.Printf(
		"publishing connection state worker_id=%s status=%s code=%d worker_status_id=%s has_qr=%t has_pairing_code=%t has_passkey_public_key=%t has_passkey_confirmation_code=%t is_new_login=%t attempt=%d max_attempts=%d connection_attempt_id=%s",
		m.cfg.WorkerID,
		state.Status,
		state.Code,
		state.WorkerStatusID,
		state.QRCode != "",
		state.PairingCode != "",
		state.PasskeyPublicKey != "",
		state.PasskeyConfirmationCode != "",
		isNewLogin,
		state.Attempt,
		state.MaxAttempts,
		state.ConnectionAttemptID,
	)
	// Lifecycle callbacks can fence Kafka while connection-state diagnostics
	// above are being assembled. Re-evaluate immediately before each external
	// online publication so a generation in repositioning is downgraded.
	if state.WorkerStatusID == WorkerStatusOnline {
		m.enrichReadiness(&state)
	}
	onlineAuthorizationAttempted := false
	onlineAuthorized := false
	if state.WorkerStatusID == WorkerStatusOnline {
		onlineAuthorizationAttempted = true
		onlineAuthorized = m.authorizeOnlineState(ctx, &state)
	}
	// apply_worker_runtime_status persists the state and its delivery intent
	// atomically for both session backends. service_api is the sole status/QR
	// drainer to Redis/Centrifugo.
	if !onlineAuthorizationAttempted && (state.WorkerStatusID == WorkerStatusOnline || state.WorkerStatusID == WorkerStatusOffline || state.WorkerStatusID == WorkerStatusDisponible || state.WorkerStatusID == WorkerStatusMismatched) {
		if err := m.persistWorkerStatus(ctx, state); err != nil {
			localConnectionStatusLog("whatsmeow.provider.status_outbox.error", map[string]any{
				"layer":                 "worker_whatsmeow.provider",
				"provider":              "whatsmeow",
				"worker_id":             state.WorkerID,
				"account_id":            state.AccountID,
				"worker_type_id":        state.WorkerTypeID,
				"worker_status_id":      state.WorkerStatusID,
				"status":                state.Status,
				"code":                  state.Code,
				"session_ready":         state.SessionReady,
				"phone":                 state.Phone,
				"connection_attempt_id": state.ConnectionAttemptID,
				"runtime_generation":    state.RuntimeGeneration,
				"reason":                safeOperationalErrorCode(err),
			})
			log.Printf("persist worker status failed worker_id=%s status=%s code=%d worker_status_id=%s error_code=%s", m.cfg.WorkerID, state.Status, state.Code, state.WorkerStatusID, safeOperationalErrorCode(err))
		} else {
			localConnectionStatusLog("whatsmeow.provider.status_outbox.ok", map[string]any{
				"layer":                 "worker_whatsmeow.provider",
				"provider":              "whatsmeow",
				"worker_id":             state.WorkerID,
				"account_id":            state.AccountID,
				"worker_type_id":        state.WorkerTypeID,
				"worker_status_id":      state.WorkerStatusID,
				"status":                state.Status,
				"code":                  state.Code,
				"session_ready":         state.SessionReady,
				"can_send":              state.CanSend,
				"can_receive_runtime":   state.CanReceiveRuntime,
				"authenticated":         state.Authenticated,
				"provider_state":        state.ProviderState,
				"degraded_reason":       state.DegradedReason,
				"phone":                 state.Phone,
				"connection_attempt_id": state.ConnectionAttemptID,
				"runtime_generation":    state.RuntimeGeneration,
			})
		}
	}
	if (code == CodeConnectionEstablished && onlineAuthorized) || code == CodeLoggedOut || code == CodeConnectionClosed {
		m.clearConnectionAttemptID()
		m.clearDebugTraceID()
	}
	return onlineRequested && onlineAuthorized && state.WorkerStatusID == WorkerStatusOnline
}

func (m *WhatsAppManager) publishStateDisconnectedByUser(ctx context.Context, code int, workerStatusID string) {
	_ = m.beginFencedProviderLifecycleEvent()
	m.deactivateInboundConnectionScope(ctx)
	state := ConnectionState{
		Code:                code,
		Status:              "disconnected",
		WorkerID:            m.cfg.WorkerID,
		AccountID:           m.cfg.AccountID,
		WorkerTypeID:        WorkerTypeWhatsmeow,
		DisconnectedUser:    true,
		Time:                time.Now().Unix(),
		WorkerStatusID:      workerStatusID,
		ConnectionAttemptID: m.getConnectionAttemptID(),
		DebugTraceID:        m.getDebugTraceID(),
		RuntimeGeneration:   m.cfg.RuntimeGeneration,
		WarmPoolID:          m.cfg.WarmPoolID,
	}
	m.attachRuntimeFenceToConnectionState(ctx, &state)
	m.enrichReadiness(&state)
	localConnectionStatusLog("whatsmeow.provider.publish_state_disconnected_user", map[string]any{
		"layer":                 "worker_whatsmeow.provider",
		"provider":              "whatsmeow",
		"worker_id":             state.WorkerID,
		"account_id":            state.AccountID,
		"worker_type_id":        state.WorkerTypeID,
		"worker_status_id":      state.WorkerStatusID,
		"status":                state.Status,
		"code":                  state.Code,
		"session_ready":         state.SessionReady,
		"can_send":              state.CanSend,
		"can_receive_runtime":   state.CanReceiveRuntime,
		"authenticated":         state.Authenticated,
		"provider_state":        state.ProviderState,
		"degraded_reason":       state.DegradedReason,
		"disconnected_user":     true,
		"connection_attempt_id": state.ConnectionAttemptID,
		"runtime_generation":    state.RuntimeGeneration,
	})
	log.Printf(
		"publishing connection state worker_id=%s status=%s code=%d worker_status_id=%s disconnected_user=true has_qr=false has_pairing_code=false is_new_login=false connection_attempt_id=%s",
		m.cfg.WorkerID,
		state.Status,
		state.Code,
		state.WorkerStatusID,
		state.ConnectionAttemptID,
	)
	if state.WorkerStatusID == WorkerStatusOnline || state.WorkerStatusID == WorkerStatusOffline || state.WorkerStatusID == WorkerStatusDisponible || state.WorkerStatusID == WorkerStatusMismatched {
		if err := m.persistWorkerStatus(ctx, state); err != nil {
			localConnectionStatusLog("whatsmeow.provider.status_outbox.error", map[string]any{
				"layer":                 "worker_whatsmeow.provider",
				"provider":              "whatsmeow",
				"worker_id":             state.WorkerID,
				"account_id":            state.AccountID,
				"worker_type_id":        state.WorkerTypeID,
				"worker_status_id":      state.WorkerStatusID,
				"status":                state.Status,
				"code":                  state.Code,
				"session_ready":         state.SessionReady,
				"connection_attempt_id": state.ConnectionAttemptID,
				"runtime_generation":    state.RuntimeGeneration,
				"disconnected_user":     true,
				"reason":                safeOperationalErrorCode(err),
			})
			log.Printf("persist worker status failed worker_id=%s status=%s code=%d worker_status_id=%s error_code=%s", m.cfg.WorkerID, state.Status, state.Code, state.WorkerStatusID, safeOperationalErrorCode(err))
		} else {
			localConnectionStatusLog("whatsmeow.provider.status_outbox.ok", map[string]any{
				"layer":                 "worker_whatsmeow.provider",
				"provider":              "whatsmeow",
				"worker_id":             state.WorkerID,
				"account_id":            state.AccountID,
				"worker_type_id":        state.WorkerTypeID,
				"worker_status_id":      state.WorkerStatusID,
				"status":                state.Status,
				"code":                  state.Code,
				"session_ready":         state.SessionReady,
				"connection_attempt_id": state.ConnectionAttemptID,
				"runtime_generation":    state.RuntimeGeneration,
				"disconnected_user":     true,
			})
		}
	}
	m.clearConnectionAttemptID()
	m.clearDebugTraceID()
}

func (m *WhatsAppManager) handleIncomingMessage(ctx context.Context, evt *events.Message) {
	if !m.isInboundConnectionScopeCurrent(ctx) {
		return
	}
	skipReason := incomingSkipReason(evt)

	if skipReason != "" {
		log.Printf(
			"whatsmeow incoming message skipped worker_id=%s reason=%s chat_hash=%s sender_hash=%s id_hash=%s from_me=%t category=%s source_web_msg=%t",
			m.cfg.WorkerID,
			skipReason,
			hashConnectionFlowIdentifier(incomingChatString(evt)),
			hashConnectionFlowIdentifier(incomingSenderString(evt)),
			hashConnectionFlowIdentifier(incomingMessageID(evt)),
			incomingFromMe(evt),
			incomingCategory(evt),
			evt != nil && evt.SourceWebMsg != nil,
		)
		return
	}
	upsert, err := m.buildIncomingUpsert(ctx, evt)
	if err != nil {
		log.Printf("failed to map incoming message worker_id=%s error_code=%s", m.cfg.WorkerID, safeOperationalErrorCode(err))
		return
	}
	if upsert == nil {
		log.Printf(
			"whatsmeow incoming message ignored worker_id=%s reason=unmapped_message chat_hash=%s sender_hash=%s id_hash=%s from_me=%t category=%s source_web_msg=%t",
			m.cfg.WorkerID,
			hashConnectionFlowIdentifier(incomingChatString(evt)),
			hashConnectionFlowIdentifier(incomingSenderString(evt)),
			hashConnectionFlowIdentifier(incomingMessageID(evt)),
			incomingFromMe(evt),
			incomingCategory(evt),
			evt != nil && evt.SourceWebMsg != nil,
		)
		return
	}
	upsert.SourceProvider = "whatsmeow"
	key := incomingUpsertKafkaKey(m.cfg, upsert)
	if err := m.publishInboundKafkaJSONWithSpool(ctx, topicUpsertMessage, key, upsert, "incoming_message", incomingChatString(evt), incomingMessageID(evt)); err != nil {
		return
	}
	hasMediaURL, mediaFailed := mediaContentPublishStatus(upsert.Content, upsert.Type)
	log.Printf(
		"whatsmeow incoming message published worker_id=%s topic=%s key_hash=%s type=%s chat_hash=%s remote_jid_alt_hash=%s sender_hash=%s id_hash=%s from_me=%t has_photo=%t has_media_url=%t media_download_failed=%t",
		m.cfg.WorkerID,
		topicUpsertMessage,
		hashConnectionFlowIdentifier(key),
		upsert.Type,
		hashConnectionFlowIdentifier(incomingChatString(evt)),
		hashConnectionFlowIdentifier(valueString(upsert.Message["key"], "remoteJidAlt")),
		hashConnectionFlowIdentifier(incomingSenderString(evt)),
		hashConnectionFlowIdentifier(incomingMessageID(evt)),
		incomingFromMe(evt),
		upsert.Photo != "",
		hasMediaURL,
		mediaFailed,
	)
}

func (m *WhatsAppManager) scheduleHistorySync(ctx context.Context, evt *events.HistorySync) {
	if m == nil || evt == nil {
		return
	}
	if ctx == nil {
		ctx = context.Background()
	}
	job := historySyncJob{ctx: ctx, evt: evt}

	m.historySyncMu.Lock()
	if m.historySyncRunning {
		// History sync notifications are snapshots/chunks which can arrive in a
		// reconnect burst. Retain only the latest pending one; the active one keeps
		// running and the stable event identity deduplicates overlap downstream.
		m.historyPending = &job
		m.historySyncMu.Unlock()
		return
	}
	m.historySyncRunning = true
	m.historySyncMu.Unlock()

	go func(current historySyncJob) {
		for {
			runner := m.historyRunner
			if runner == nil {
				runner = m.handleHistorySync
			}
			runner(current.ctx, current.evt)

			m.historySyncMu.Lock()
			if m.historyPending == nil {
				m.historySyncRunning = false
				m.historySyncMu.Unlock()
				return
			}
			current = *m.historyPending
			m.historyPending = nil
			m.historySyncMu.Unlock()
		}
	}(job)
}

func (m *WhatsAppManager) handleHistorySync(ctx context.Context, evt *events.HistorySync) {
	if !m.cfg.HistoryReconciliationEnabled ||
		!m.isInboundConnectionScopeCurrent(ctx) ||
		evt == nil ||
		evt.Data == nil {
		return
	}
	historyCtx, cancelHistory := context.WithCancel(ctx)
	scopeWatchDone := make(chan struct{})
	go func() {
		defer close(scopeWatchDone)
		ticker := time.NewTicker(250 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-historyCtx.Done():
				return
			case <-ticker.C:
				if !m.isInboundConnectionScopeLocallyCurrent(historyCtx) {
					cancelHistory()
					return
				}
			}
		}
	}()
	defer func() {
		cancelHistory()
		<-scopeWatchDone
	}()
	ctx = historyCtx
	release, acquired := m.acquireHistorySync(ctx)
	if !acquired {
		return
	}
	defer release()
	if ctx.Err() != nil || !m.isInboundConnectionScopeLocallyCurrent(ctx) {
		return
	}

	client := m.getClient()
	if !m.isAuthenticated(client) {
		return
	}

	globalLimit := m.cfg.HistoryReconciliationMessageLimit
	if globalLimit <= 0 {
		globalLimit = defaultHistoryReconciliationMessageLimit
	}
	chatScanLimit := m.cfg.HistoryReconciliationChatScanLimit
	if chatScanLimit <= 0 {
		chatScanLimit = defaultHistoryReconciliationChatScanLimit
	}
	perChatLimit := m.cfg.HistoryReconciliationPerChatLimit
	if perChatLimit <= 0 {
		perChatLimit = defaultHistoryReconciliationPerChatLimit
	}
	selector := newHistorySyncCandidateSelector(globalLimit)
	scannedChats := 0
	for _, conversation := range boundedHistoryConversations(evt.Data.GetConversations(), chatScanLimit) {
		if ctx.Err() != nil || !m.isInboundConnectionScopeLocallyCurrent(ctx) {
			return
		}
		scannedChats++
		if conversation == nil {
			continue
		}

		chatJID, err := types.ParseJID(conversation.GetID())
		if err != nil || !isWhatsmeowUserChat(chatJID) {
			continue
		}
		chatSelector := newHistorySyncCandidateSelector(perChatLimit)
		for _, historyMessage := range boundedHistoryMessages(conversation.GetMessages(), perChatLimit) {
			if ctx.Err() != nil || !m.isInboundConnectionScopeLocallyCurrent(ctx) {
				return
			}
			candidate, ok := m.buildHistorySyncCandidate(chatJID, historyMessage)
			if !ok {
				continue
			}
			chatSelector.Add(candidate)
		}
		for _, candidate := range chatSelector.Selected() {
			selector.Add(candidate)
		}
	}

	// The heap is capped while scanning. ParseWebMessage and all enrichment
	// therefore run only for the bounded newest set, never for the full dump.
	candidates := selector.Selected()

	published := 0
	for _, candidate := range candidates {
		if ctx.Err() != nil || !m.isInboundConnectionScopeLocallyCurrent(ctx) {
			return
		}
		chatJID := candidate.chatJID
		historyMessage := candidate.message
		webMessage := historyMessage.GetMessage()
		if webMessage == nil || !m.isRecentHistoryWebMessage(webMessage.GetMessageTimestamp()) {
			continue
		}

		messageEvent, err := client.ParseWebMessage(chatJID, webMessage)
		if err != nil {
			log.Printf("whatsmeow history sync parse failed worker_id=%s chat_jid_hash=%s error_code=%s", m.cfg.WorkerID, hashConnectionFlowIdentifier(chatJID.String()), safeOperationalErrorCode(err))
			continue
		}
		if messageEvent == nil || messageEvent.Info.IsFromMe {
			continue
		}
		if ctx.Err() != nil || !m.isInboundConnectionScopeLocallyCurrent(ctx) {
			return
		}

		upsert, err := m.buildIncomingUpsert(ctx, messageEvent, true)
		if err != nil {
			log.Printf("whatsmeow history sync map failed worker_id=%s chat_jid_hash=%s message_id_hash=%s error_code=%s", m.cfg.WorkerID, hashConnectionFlowIdentifier(chatJID.String()), hashConnectionFlowIdentifier(incomingMessageID(messageEvent)), safeOperationalErrorCode(err))
			continue
		}
		if upsert == nil {
			continue
		}
		upsert.SourceProvider = "whatsmeow"

		key := incomingUpsertKafkaKey(m.cfg, upsert)
		if err := m.publishInboundKafkaJSONWithSpool(ctx, topicUpsertMessageHistory, key, upsert, "history_sync", chatJID.String(), incomingMessageID(messageEvent)); err != nil {
			continue
		}
		published++
	}

	if published > 0 {
		log.Printf("whatsmeow history sync candidates published worker_id=%s chats_scanned=%d selected=%d count=%d", m.cfg.WorkerID, scannedChats, len(candidates), published)
	}
}

func (m *WhatsAppManager) acquireHistorySync(ctx context.Context) (func(), bool) {
	if ctx == nil {
		ctx = context.Background()
	}
	m.historySyncMu.Lock()
	if m.historySyncGate == nil {
		m.historySyncGate = make(chan struct{}, 1)
	}
	gate := m.historySyncGate
	m.historySyncMu.Unlock()

	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	for {
		if ctx.Err() != nil || !m.isInboundConnectionScopeLocallyCurrent(ctx) {
			return nil, false
		}
		select {
		case gate <- struct{}{}:
			return func() { <-gate }, true
		case <-ctx.Done():
			return nil, false
		case <-ticker.C:
		}
	}
}

func (m *WhatsAppManager) sendInboundKafkaJSONWithRetry(ctx context.Context, topic string, key string, value any, event string, chat string, messageID string) error {
	if !m.isInboundConnectionScopeCurrent(ctx) {
		return nil
	}
	var lastErr error
	for attempt := 1; attempt <= inboundKafkaPublishMaxAttempts; attempt++ {
		if !m.isInboundConnectionScopeCurrent(ctx) {
			return nil
		}
		err := m.kafka.SendJSON(ctx, topic, key, value)
		if err == nil {
			if attempt > 1 {
				log.Printf(
					"whatsmeow inbound kafka publish recovered worker_id=%s event=%s topic=%s key_hash=%s chat_hash=%s id_hash=%s attempt=%d",
					m.cfg.WorkerID,
					event,
					topic,
					hashConnectionFlowIdentifier(key),
					hashConnectionFlowIdentifier(chat),
					hashConnectionFlowIdentifier(messageID),
					attempt,
				)
			}
			return nil
		}

		lastErr = err
		if attempt >= inboundKafkaPublishMaxAttempts {
			break
		}

		delay := inboundKafkaPublishBaseDelay * time.Duration(1<<(attempt-1))
		if delay > inboundKafkaPublishMaxDelay {
			delay = inboundKafkaPublishMaxDelay
		}
		log.Printf(
			"whatsmeow inbound kafka publish failed worker_id=%s event=%s topic=%s key_hash=%s chat_hash=%s id_hash=%s attempt=%d max_attempts=%d next_retry_ms=%d error_code=%s",
			m.cfg.WorkerID,
			event,
			topic,
			hashConnectionFlowIdentifier(key),
			hashConnectionFlowIdentifier(chat),
			hashConnectionFlowIdentifier(messageID),
			attempt,
			inboundKafkaPublishMaxAttempts,
			delay.Milliseconds(),
			safeOperationalErrorCode(err),
		)

		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			if !timer.Stop() {
				<-timer.C
			}
			return ctx.Err()
		case <-timer.C:
		}
	}

	log.Printf(
		"whatsmeow inbound kafka publish failed after retries worker_id=%s event=%s topic=%s key_hash=%s chat_hash=%s id_hash=%s attempts=%d error_code=%s",
		m.cfg.WorkerID,
		event,
		topic,
		hashConnectionFlowIdentifier(key),
		hashConnectionFlowIdentifier(chat),
		hashConnectionFlowIdentifier(messageID),
		inboundKafkaPublishMaxAttempts,
		safeOperationalErrorCode(lastErr),
	)
	return lastErr
}

type historySyncCandidateHeap []historySyncCandidate

func (h historySyncCandidateHeap) Len() int { return len(h) }

func (h historySyncCandidateHeap) Less(i, j int) bool {
	return historyTimestampMillis(h[i].timestamp) < historyTimestampMillis(h[j].timestamp)
}

func (h historySyncCandidateHeap) Swap(i, j int) { h[i], h[j] = h[j], h[i] }

func (h *historySyncCandidateHeap) Push(value any) {
	*h = append(*h, value.(historySyncCandidate))
}

func (h *historySyncCandidateHeap) Pop() any {
	old := *h
	last := old[len(old)-1]
	*h = old[:len(old)-1]
	return last
}

type historySyncCandidateSelector struct {
	limit      int
	candidates historySyncCandidateHeap
}

func newHistorySyncCandidateSelector(limit int) *historySyncCandidateSelector {
	selector := &historySyncCandidateSelector{limit: limit}
	heap.Init(&selector.candidates)
	return selector
}

func (s *historySyncCandidateSelector) Add(candidate historySyncCandidate) {
	if s == nil || s.limit <= 0 {
		return
	}
	if s.candidates.Len() < s.limit {
		heap.Push(&s.candidates, candidate)
		return
	}
	if historyTimestampMillis(candidate.timestamp) <= historyTimestampMillis(s.candidates[0].timestamp) {
		return
	}
	heap.Pop(&s.candidates)
	heap.Push(&s.candidates, candidate)
}

func (s *historySyncCandidateSelector) Selected() []historySyncCandidate {
	if s == nil || s.candidates.Len() == 0 {
		return nil
	}
	selected := append([]historySyncCandidate(nil), s.candidates...)
	sort.SliceStable(selected, func(i, j int) bool {
		return historyTimestampMillis(selected[i].timestamp) < historyTimestampMillis(selected[j].timestamp)
	})
	return selected
}

func selectLatestHistorySyncCandidates(candidates []historySyncCandidate, limit int) []historySyncCandidate {
	selector := newHistorySyncCandidateSelector(limit)
	for _, candidate := range candidates {
		selector.Add(candidate)
	}
	return selector.Selected()
}

func boundedHistoryConversations(
	conversations []*waHistorySync.Conversation,
	limit int,
) []*waHistorySync.Conversation {
	if limit <= 0 || len(conversations) <= limit {
		return conversations
	}
	// History arrays have appeared in both chronological directions. Compare
	// the edge timestamps and retain the recent edge without walking the whole
	// snapshot just to decide which conversations to inspect.
	if historyConversationTimestamp(conversations[0]) >=
		historyConversationTimestamp(conversations[len(conversations)-1]) {
		return conversations[:limit]
	}
	return conversations[len(conversations)-limit:]
}

func boundedHistoryMessages(
	messages []*waHistorySync.HistorySyncMsg,
	limit int,
) []*waHistorySync.HistorySyncMsg {
	if limit <= 0 || len(messages) <= limit {
		return messages
	}
	// Keep a full recent window (rather than half of each edge) after detecting
	// whether this WhatsApp build emitted oldest-first or newest-first history.
	if historySyncMessageTimestamp(messages[0]) >=
		historySyncMessageTimestamp(messages[len(messages)-1]) {
		return messages[:limit]
	}
	return messages[len(messages)-limit:]
}

func historyConversationTimestamp(conversation *waHistorySync.Conversation) uint64 {
	if conversation == nil {
		return 0
	}
	return firstNonZeroUint64(
		conversation.GetLastMsgTimestamp(),
		conversation.GetConversationTimestamp(),
	)
}

func firstNonZeroUint64(values ...uint64) uint64 {
	for _, value := range values {
		if value != 0 {
			return value
		}
	}
	return 0
}

func historyTimestampMillis(timestamp uint64) int64 {
	if timestamp == 0 {
		return 0
	}
	if timestamp > 1_000_000_000_000 {
		return int64(timestamp)
	}
	return int64(timestamp) * int64(time.Second/time.Millisecond)
}

func (m *WhatsAppManager) buildHistorySyncCandidate(chatJID types.JID, historyMessage *waHistorySync.HistorySyncMsg) (historySyncCandidate, bool) {
	webMessage := historyMessage.GetMessage()
	if webMessage == nil {
		return historySyncCandidate{}, false
	}

	if webMessage.GetKey().GetFromMe() {
		return historySyncCandidate{}, false
	}

	timestamp := webMessage.GetMessageTimestamp()
	if timestamp == 0 || !m.isRecentHistoryWebMessage(timestamp) {
		return historySyncCandidate{}, false
	}

	return historySyncCandidate{
		chatJID:   chatJID,
		message:   historyMessage,
		timestamp: timestamp,
	}, true
}

func (m *WhatsAppManager) isRecentHistoryWebMessage(timestamp uint64) bool {
	if timestamp == 0 {
		return false
	}

	timestampMs := historyTimestampMillis(timestamp)

	_, ok := m.currentInboundConnectionScope()
	if !ok {
		return false
	}
	window := m.cfg.HistoryReconciliationWindow
	if window <= 0 {
		window = defaultHistoryReconciliationWindow
	}
	cutoffMillis := time.Now().Add(-window).UnixMilli()
	return timestampMs >= cutoffMillis
}

func (m *WhatsAppManager) handleReceipt(ctx context.Context, evt *events.Receipt) {
	if !m.isInboundConnectionScopeCurrent(ctx) || evt == nil {
		return
	}
	scope, ok := inboundConnectionScopeFromContext(ctx)
	if !ok {
		return
	}
	effectLease, err := m.acquireRuntimeEffectLease(ctx, scope)
	if err != nil || effectLease == nil {
		if err != nil {
			log.Printf(
				"whatsmeow receipt effect lease failed worker_id=%s error_code=%s",
				m.cfg.WorkerID,
				safeOperationalErrorCode(err),
			)
		}
		return
	}
	defer func() {
		releaseCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		if _, releaseErr := effectLease.release(releaseCtx); releaseErr != nil {
			log.Printf(
				"whatsmeow receipt effect lease release failed worker_id=%s error_code=%s",
				m.cfg.WorkerID,
				safeOperationalErrorCode(releaseErr),
			)
		}
		cancel()
	}()
	patch := map[string]any{}
	switch evt.Type {
	case types.ReceiptTypeRead, types.ReceiptTypeReadSelf, types.ReceiptTypePlayed, types.ReceiptTypePlayedSelf:
		patch["is_seen"] = true
	case types.ReceiptTypeDelivered, types.ReceiptTypeSender:
		patch["is_delivered"] = true
	default:
		patch["is_sent"] = true
	}
	for _, id := range evt.MessageIDs {
		update := MessageStatusUpdate{
			AccountID:         m.cfg.AccountID,
			WorkerID:          m.cfg.WorkerID,
			SourceProvider:    "whatsmeow",
			RuntimeGeneration: scope.RuntimeGeneration,
			ConnectionEpoch:   scope.ConnectionEpoch,
			MessageID:         string(id),
			Patch:             patch,
			Key: map[string]any{
				"id":        string(id),
				"remoteJid": evt.Chat.String(),
				"fromMe":    true,
			},
		}
		ensureMessageStatusEventID(&update)
		if !m.isInboundConnectionScopeCurrent(ctx) {
			return
		}
		_ = m.kafka.SendJSON(
			ctx,
			topicUpdateMessageStatus,
			messageStatusKafkaKey(m.cfg.AccountID, m.cfg.WorkerID, string(id)),
			update,
		)
	}
}

func (m *WhatsAppManager) handleCallOffer(ctx context.Context, callFrom types.JID, callID string, creator types.JID, isVideo bool) {
	if !m.isInboundConnectionScopeCurrent(ctx) {
		return
	}
	scope, ok := inboundConnectionScopeFromContext(ctx)
	if !ok {
		return
	}
	effectLease, err := m.acquireRuntimeEffectLease(ctx, scope)
	if err != nil || effectLease == nil {
		if err != nil {
			log.Printf(
				"whatsmeow call event effect lease failed worker_id=%s call_id_hash=%s error_code=%s",
				m.cfg.WorkerID,
				hashConnectionFlowIdentifier(callID),
				safeOperationalErrorCode(err),
			)
		}
		return
	}
	defer func() {
		releaseCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		if _, releaseErr := effectLease.release(releaseCtx); releaseErr != nil {
			log.Printf(
				"whatsmeow call event effect lease release failed worker_id=%s call_id_hash=%s error_code=%s",
				m.cfg.WorkerID,
				hashConnectionFlowIdentifier(callID),
				safeOperationalErrorCode(releaseErr),
			)
		}
		cancel()
	}()
	callJID := callFrom.String()
	if callJID == "" {
		callJID = creator.String()
	}
	callEventJID := creator.String()
	if callEventJID == "" {
		callEventJID = callJID
	}
	callJIDAlt := callAltJID(callFrom, creator)
	callPhone := callPhoneFromJIDs(callFrom, creator)
	callText := "Ligacao recebida"
	if isVideo {
		callText = "Ligacao de video recebida"
	}
	key := map[string]any{
		"id":        "call_" + firstNonEmpty(callID, fmt.Sprintf("%d", time.Now().UnixMilli())),
		"remoteJid": callJID,
		"fromMe":    false,
	}
	if callJIDAlt != "" {
		key["remoteJidAlt"] = callJIDAlt
	}
	upsert := UpsertMessage{
		WorkerID:       m.cfg.WorkerID,
		AccountID:      m.cfg.AccountID,
		SourceProvider: "whatsmeow",
		EventID:        stableCallInboundEventID(m.cfg.AccountID, m.cfg.WorkerID, callID, callEventJID),
		EventRevision:  strings.TrimSpace(callID),
		Type:           MessageTypeSystem,
		Photo:          m.profilePhotoForJIDs(ctx, []types.JID{callFrom, creator}),
		HasQuoted:      false,
		IsCallEvent:    true,
		CallPhone:      callPhone,
		CallJID:        callJID,
		CallJIDAlt:     callJIDAlt,
		Message: map[string]any{
			"key":              key,
			"message":          map[string]any{"conversation": callText},
			"messageTimestamp": time.Now().Unix(),
		},
	}
	kafkaKey := incomingUpsertKafkaKey(m.cfg, &upsert)
	if err := m.publishInboundKafkaJSONWithSpool(ctx, topicUpsertMessage, kafkaKey, &upsert, "call_event", callJID, callID); err != nil {
		log.Printf("whatsmeow call event upsert deferred worker_id=%s key_hash=%s error_code=%s", m.cfg.WorkerID, hashConnectionFlowIdentifier(kafkaKey), safeOperationalErrorCode(err))
	}

	reject, showMessage, text, err := m.postgres.ResolveIncomingCallAction(ctx, m.cfg, m.redis, callJID, callPhone, isVideo)
	if err != nil {
		log.Printf("failed to resolve call action worker_id=%s error_code=%s", m.cfg.WorkerID, safeOperationalErrorCode(err))
	}
	if m.rejectCallsEnabled() || reject {
		if !m.isInboundConnectionScopeCurrent(ctx) {
			return
		}
		if client := m.getClient(); client != nil && callID != "" {
			if _, rejectErr := invokeWhatsmeowProviderOperationWithDeadline(
				ctx,
				m,
				client,
				"reject_call:"+callID,
				m.cfg.SendTimeout,
				func(invokeCtx context.Context) (struct{}, error) {
					return struct{}{}, client.RejectCall(
						invokeCtx,
						callFrom,
						callID,
					)
				},
			); rejectErr != nil {
				log.Printf(
					"whatsmeow reject call failed worker_id=%s call_id_hash=%s error_code=%s",
					m.cfg.WorkerID,
					hashConnectionFlowIdentifier(callID),
					safeOperationalErrorCode(rejectErr),
				)
			}
		}
	}
	if showMessage && strings.TrimSpace(text) != "" {
		if !m.isInboundConnectionScopeCurrent(ctx) {
			return
		}
		if err := m.sendCallAutoReply(ctx, callJID, callID, text); err != nil {
			log.Printf("failed to send call auto reply worker_id=%s call_id_hash=%s error_code=%s", m.cfg.WorkerID, hashConnectionFlowIdentifier(callID), safeOperationalErrorCode(err))
		}
	}
}

func callAutoReplyOperationID(workerID, callID string) string {
	workerID = strings.TrimSpace(workerID)
	callID = strings.TrimSpace(callID)
	if workerID == "" || callID == "" {
		return ""
	}
	// This exact provider-neutral operation ID is shared with WWebJS/Baileys.
	// Destination must not split CallOffer from CallOfferNotice.
	return "call-auto-reply:" + workerID + ":" + callID
}

func (m *WhatsAppManager) sendCallAutoReply(ctx context.Context, callJID, callID, text string) error {
	operationID := callAutoReplyOperationID(m.cfg.WorkerID, callID)
	if operationID == "" || canonicalInboundJID(callJID) == "" {
		// Without the immutable WhatsApp call ID, CallOffer and
		// CallOfferNotice cannot be proven to be the same physical call.
		// Fail closed instead of risking a duplicate auto-reply.
		return errors.New("stable call id and destination are required for call auto reply")
	}
	operation := outboundSendOperation{
		AccountID: m.cfg.AccountID,
		Type:      "direct",
		ID:        operationID,
	}
	claim, err := claimOutboundOperationWithRedis(ctx, m.redis, operation, map[string]any{
		"worker_id": m.cfg.WorkerID,
		"call_id":   callID,
		"chat_id":   canonicalInboundJID(callJID),
		"source":    "incoming_call_auto_reply",
	})
	if err != nil {
		return err
	}
	if !claim.Acquired {
		return nil
	}
	releaseReservation := func() {
		releaseCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		if releaseErr := releaseOutboundReservationWithRedis(
			releaseCtx,
			m.redis,
			claim,
			outboundRecoveryQueueKey(m.cfg.WorkerID),
			false,
		); releaseErr != nil {
			log.Printf("whatsmeow call auto reply reservation release failed worker_id=%s call_id_hash=%s error_code=%s", m.cfg.WorkerID, hashConnectionFlowIdentifier(callID), safeOperationalErrorCode(releaseErr))
		}
	}

	msg := ChatMessage{
		MessageID: "call_autoreply_" + hashRaw(map[string]any{"call_id": callID, "chat_id": canonicalInboundJID(callJID)}),
		ChatID:    callJID,
		MessageKey: &MessageKey{
			RemoteJID: callJID,
		},
		Content: map[string]any{
			"type":    MessageTypeText,
			"message": text,
		},
	}
	providerInvoked := false
	authorize := func(authorizeCtx context.Context) error {
		scope, ok := inboundConnectionScopeFromContext(ctx)
		if !ok {
			return errWhatsAppRuntimeFenceRevoked
		}
		return m.assertCapturedConnectionScope(authorizeCtx, scope)
	}
	boundary := func(boundaryCtx context.Context) error {
		return runOutboundProviderInvocationFence(
			boundaryCtx,
			&providerInvoked,
			authorize,
			func(markCtx context.Context) error {
				return markOutboundProviderInvokedWithRedis(markCtx, m.redis, claim)
			},
			func(revertCtx context.Context, _ error) error {
				return revertOutboundProviderInvocationBeforeStartWithRedis(
					revertCtx,
					m.redis,
					claim,
				)
			},
		)
	}
	var result map[string]any
	sendCtx := withOutboundProviderStallHandler(
		ctx,
		func(stallCtx context.Context, cause error) error {
			return retryOutboundPostProviderSideEffect(
				stallCtx,
				func(attemptCtx context.Context) error {
					return transitionOutboundClaimWithRedis(
						attemptCtx,
						m.redis,
						claim,
						sendIdempotencyStateInvoked,
						sendIdempotencyStateAmbiguous,
						0,
						nil,
						cause,
						nil,
					)
				},
			)
		},
	)
	if m.callAutoReplySender != nil {
		result, err = m.callAutoReplySender(sendCtx, msg, boundary)
	} else {
		result, err = m.SendChatMessageWithInvocationBoundary(sendCtx, msg, authorize, boundary)
	}
	if err != nil {
		if !providerInvoked {
			releaseReservation()
			return err
		}
		transitionErr := transitionOutboundClaimWithRedis(ctx, m.redis, claim, sendIdempotencyStateInvoked, sendIdempotencyStateAmbiguous, 0, nil, err, nil)
		if transitionErr != nil {
			return errors.Join(err, transitionErr)
		}
		return err
	}
	if !providerInvoked {
		releaseReservation()
		return errors.New("call auto reply provider invocation boundary was not reached")
	}
	return retryOutboundPostProviderSideEffect(ctx, func(attemptCtx context.Context) error {
		return transitionOutboundClaimWithRedis(attemptCtx, m.redis, claim, sendIdempotencyStateInvoked, sendIdempotencyStateSucceeded, 0, map[string]any{
			"external_message_id": messageKeyFromSendResult(result),
		}, nil, nil)
	})
}

func (m *WhatsAppManager) markPresenceAvailable(ctx context.Context, reason string) {
	scope, ok := inboundConnectionScopeFromContext(ctx)
	if !ok || m.assertCapturedConnectionScope(ctx, scope) != nil {
		return
	}
	effectLease, err := m.acquireRuntimeEffectLease(ctx, scope)
	if err != nil || effectLease == nil {
		if err != nil {
			log.Printf(
				"whatsmeow presence effect lease failed worker_id=%s reason=%s error_code=%s",
				m.cfg.WorkerID,
				reason,
				safeOperationalErrorCode(err),
			)
		}
		return
	}
	defer func() {
		releaseCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		if _, releaseErr := effectLease.release(releaseCtx); releaseErr != nil {
			log.Printf(
				"whatsmeow presence effect lease release failed worker_id=%s reason=%s error_code=%s",
				m.cfg.WorkerID,
				reason,
				safeOperationalErrorCode(releaseErr),
			)
		}
		cancel()
	}()
	client := m.getClient()
	if client == nil {
		log.Printf("whatsmeow presence available skipped worker_id=%s reason=%s client_nil=true", m.cfg.WorkerID, reason)
		return
	}
	if client.Store != nil && strings.TrimSpace(client.Store.PushName) == "" {
		client.Store.PushName = "Underchat"
		log.Printf("whatsmeow presence available using fallback push name worker_id=%s reason=%s", m.cfg.WorkerID, reason)
	}

	presenceCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := m.assertCapturedConnectionScope(ctx, scope); err != nil {
		return
	}
	_, err = invokeWhatsmeowProviderOperationWithDeadline(
		presenceCtx,
		m,
		client,
		"presence_available",
		5*time.Second,
		func(invokeCtx context.Context) (struct{}, error) {
			return struct{}{}, client.SendPresence(
				invokeCtx,
				types.PresenceAvailable,
			)
		},
	)
	if err != nil {
		log.Printf("whatsmeow presence available failed worker_id=%s reason=%s error_code=%s", m.cfg.WorkerID, reason, safeOperationalErrorCode(err))
		return
	}
	log.Printf("whatsmeow presence available sent worker_id=%s reason=%s", m.cfg.WorkerID, reason)
}

func chatPresencePayload(cfg Config, evt *events.ChatPresence) (map[string]any, bool) {
	if evt == nil {
		return nil, false
	}

	jid := evt.Chat.String()
	if jid == "" {
		jid = evt.Sender.String()
	}
	if jid == "" {
		return nil, false
	}

	typingState := ""
	isTyping := false
	isRecording := false

	switch evt.State {
	case types.ChatPresenceComposing:
		if evt.Media == types.ChatPresenceMediaAudio {
			typingState = "recording"
			isRecording = true
		} else {
			typingState = "typing"
			isTyping = true
		}
	case types.ChatPresencePaused:
		typingState = "available"
	default:
		return nil, false
	}

	payload := map[string]any{
		"type":         "typing",
		"jid":          jid,
		"is_typing":    isTyping,
		"is_recording": isRecording,
		"typing_state": typingState,
		"account_id":   cfg.AccountID,
		"worker_id":    cfg.WorkerID,
		"provider":     "whatsmeow",
		"chat_jid":     evt.Chat.String(),
		"sender_jid":   evt.Sender.String(),
		"state":        string(evt.State),
		"media":        string(evt.Media),
	}
	if alt := evt.SenderAlt.String(); alt != "" {
		payload["sender_jid_alt"] = alt
	}
	if alt := evt.RecipientAlt.String(); alt != "" {
		payload["recipient_jid_alt"] = alt
	}
	return payload, true
}

func (m *WhatsAppManager) publishPresence(ctx context.Context, evt *events.ChatPresence) {
	if !m.isInboundConnectionScopeCurrent(ctx) {
		return
	}
	scope, ok := inboundConnectionScopeFromContext(ctx)
	if !ok {
		return
	}
	effectLease, err := m.acquireRuntimeEffectLease(ctx, scope)
	if err != nil || effectLease == nil {
		if err != nil {
			log.Printf(
				"whatsmeow chat presence effect lease failed worker_id=%s error_code=%s",
				m.cfg.WorkerID,
				safeOperationalErrorCode(err),
			)
		}
		return
	}
	defer func() {
		releaseCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		if _, releaseErr := effectLease.release(releaseCtx); releaseErr != nil {
			log.Printf(
				"whatsmeow chat presence effect lease release failed worker_id=%s error_code=%s",
				m.cfg.WorkerID,
				safeOperationalErrorCode(releaseErr),
			)
		}
		cancel()
	}()
	payload, ok := chatPresencePayload(m.cfg, evt)
	if !ok {
		if evt != nil {
			log.Printf("whatsmeow chat presence skipped worker_id=%s chat_hash=%s sender_hash=%s state=%s media=%s", m.cfg.WorkerID, hashConnectionFlowIdentifier(evt.Chat.String()), hashConnectionFlowIdentifier(evt.Sender.String()), evt.State, evt.Media)
		}
		return
	}
	log.Printf("whatsmeow chat presence received worker_id=%s jid_hash=%s state=%s media=%s typing_state=%s", m.cfg.WorkerID, hashConnectionFlowIdentifier(payload["jid"]), payload["state"], payload["media"], payload["typing_state"])
	if m.centrifugo == nil {
		return
	}
	_ = m.centrifugo.Publish(ctx, chatAccountCentrifugo(m.cfg.AccountID), payload)
}

func (m *WhatsAppManager) buildIncomingUpsert(ctx context.Context, evt *events.Message, fromHistorySync ...bool) (*UpsertMessage, error) {
	isHistorySync := len(fromHistorySync) > 0 && fromHistorySync[0]
	if incomingSkipReasonWithHistory(evt, isHistorySync) != "" {
		return nil, nil
	}
	messageMap := map[string]any{}
	if raw, err := protojson.Marshal(evt.Message); err == nil {
		_ = json.Unmarshal(raw, &messageMap)
		normalizeIncomingMessageMapForBaileys(messageMap)
	}

	var messageType string
	var content map[string]any
	if isHistorySync {
		messageType, content = m.incomingHistoryContent(ctx, evt)
	} else {
		messageType, content = m.incomingContent(ctx, evt)
	}
	if messageType == "" {
		return nil, nil
	}
	if isHistorySync {
		// Raw protobuf payloads and quoted content can embed thumbnails, media
		// keys and temporary provider URLs even when the top-level message is
		// textual. Strip those fields from every history replay.
		stripHistoryMediaTransportFields(messageMap)
		stripHistoryMediaTransportFields(content)
	}
	if messageType == MessageTypeEditText {
		normalizeIncomingEditMessageMapForBaileys(messageMap, evt, content)
	}
	key := m.buildIncomingMessageKey(evt)
	photo := ""
	if !isHistorySync {
		photo = m.incomingProfilePhoto(ctx, evt)
	}
	_, hasQuoted := content["quoted"]

	return &UpsertMessage{
		WorkerID:       m.cfg.WorkerID,
		AccountID:      m.cfg.AccountID,
		SourceProvider: "whatsmeow",
		Type:           messageType,
		Message: map[string]any{
			"key":              key,
			"message":          messageMap,
			"messageTimestamp": evt.Info.Timestamp.Unix(),
			"pushName":         evt.Info.PushName,
		},
		Content:         content,
		Photo:           photo,
		HasQuoted:       hasQuoted,
		FromHistorySync: isHistorySync,
	}, nil
}

func stripHistoryMediaTransportFields(value any) {
	switch typed := value.(type) {
	case map[string]any:
		mediaTransport := historyMapContainsMediaTransport(typed)
		for key, child := range typed {
			switch key {
			case "url":
				if mediaTransport {
					delete(typed, key)
					continue
				}
				stripHistoryMediaTransportFields(child)
			case "directPath",
				"direct_path",
				"mediaKey",
				"media_key",
				"mediaKeyTimestamp",
				"media_key_timestamp",
				"fileSha256",
				"file_sha256",
				"fileEncSha256",
				"file_enc_sha256",
				"jpegThumbnail",
				"jpeg_thumbnail",
				"thumbnailDirectPath",
				"thumbnail_direct_path",
				"thumbnailSha256",
				"thumbnail_sha256",
				"thumbnailEncSha256",
				"thumbnail_enc_sha256",
				"streamingSidecar",
				"streaming_sidecar",
				"scansSidecar",
				"scans_sidecar",
				"waveform":
				delete(typed, key)
			default:
				stripHistoryMediaTransportFields(child)
			}
		}
	case []any:
		for _, child := range typed {
			stripHistoryMediaTransportFields(child)
		}
	}
}

func historyMapContainsMediaTransport(value map[string]any) bool {
	for _, key := range []string{
		"directPath",
		"direct_path",
		"mediaKey",
		"media_key",
		"fileSha256",
		"file_sha256",
		"fileEncSha256",
		"file_enc_sha256",
		"jpegThumbnail",
		"jpeg_thumbnail",
		"streamingSidecar",
		"streaming_sidecar",
		"scansSidecar",
		"scans_sidecar",
		"waveform",
	} {
		if _, ok := value[key]; ok {
			return true
		}
	}
	return false
}

func normalizeIncomingMessageMapForBaileys(messageMap map[string]any) {
	if len(messageMap) == 0 {
		return
	}

	normalizeReactionMessagePayload(messageMap, "reactionMessage")
	normalizeReactionMessagePayload(messageMap, "encReactionMessage")
	normalizeMessageAssociationPayload(messageMap)

	for _, wrapperName := range []string{
		"ephemeralMessage",
		"viewOnceMessage",
		"viewOnceMessageV2",
		"viewOnceMessageV2Extension",
	} {
		wrapper := asMap(messageMap[wrapperName])
		inner := asMap(wrapper["message"])
		if len(inner) > 0 {
			normalizeIncomingMessageMapForBaileys(inner)
		}
	}
}

func normalizeIncomingEditMessageMapForBaileys(messageMap map[string]any, evt *events.Message, content map[string]any) {
	if len(messageMap) == 0 || evt == nil {
		return
	}

	protocolMessage := firstIncomingProtocolMessageMap(messageMap)
	if len(protocolMessage) == 0 {
		protocolMessage = map[string]any{}
		messageMap["protocolMessage"] = protocolMessage
	}

	if stringValue(protocolMessage["type"]) == "" {
		protocolMessage["type"] = "MESSAGE_EDIT"
	}

	key := asMap(protocolMessage["key"])
	if len(key) == 0 {
		key = map[string]any{}
		protocolMessage["key"] = key
	}
	secretTargetKey := asMap(asMap(messageMap["secretEncryptedMessage"])["targetMessageKey"])
	targetID := firstNonEmpty(stringValue(secretTargetKey["id"]), stringValue(secretTargetKey["ID"]))
	targetRemoteJID := firstNonEmpty(
		stringValue(secretTargetKey["remoteJid"]),
		stringValue(secretTargetKey["remoteJID"]),
		stringValue(secretTargetKey["remote_jid"]),
	)
	targetParticipant := firstNonEmpty(
		stringValue(secretTargetKey["participant"]),
		stringValue(secretTargetKey["participantJID"]),
		stringValue(secretTargetKey["participantJid"]),
	)
	if stringValue(key["id"]) == "" {
		key["id"] = firstNonEmpty(targetID, evt.Info.ID)
	}
	if stringValue(key["remoteJid"]) == "" {
		key["remoteJid"] = firstNonEmpty(targetRemoteJID, evt.Info.Chat.String())
	}
	if _, ok := key["fromMe"]; !ok {
		if fromMe, hasFromMe := secretTargetKey["fromMe"]; hasFromMe {
			key["fromMe"] = fromMe
		} else {
			key["fromMe"] = evt.Info.IsFromMe
		}
	}
	if stringValue(key["participant"]) == "" {
		if targetParticipant != "" {
			key["participant"] = targetParticipant
		} else if !evt.Info.Sender.IsEmpty() && evt.Info.Sender != evt.Info.Chat {
			key["participant"] = evt.Info.Sender.String()
		}
	}

	message := stringValue(content["message"])
	editedMessage := asMap(protocolMessage["editedMessage"])
	if len(editedMessage) == 0 {
		editedMessage = map[string]any{}
		protocolMessage["editedMessage"] = editedMessage
	}
	if stringValue(editedMessage["conversation"]) == "" {
		editedMessage["conversation"] = message
	}
	extendedTextMessage := asMap(editedMessage["extendedTextMessage"])
	if len(extendedTextMessage) == 0 {
		extendedTextMessage = map[string]any{}
		editedMessage["extendedTextMessage"] = extendedTextMessage
	}
	if stringValue(extendedTextMessage["text"]) == "" {
		extendedTextMessage["text"] = message
	}
}

func firstIncomingProtocolMessageMap(messageMap map[string]any) map[string]any {
	if protocolMessage := asMap(messageMap["protocolMessage"]); len(protocolMessage) > 0 {
		return protocolMessage
	}
	editedMessage := asMap(messageMap["editedMessage"])
	if protocolMessage := asMap(asMap(editedMessage["message"])["protocolMessage"]); len(protocolMessage) > 0 {
		return protocolMessage
	}
	return nil
}

func normalizeReactionMessagePayload(messageMap map[string]any, field string) {
	reaction := asMap(messageMap[field])
	if len(reaction) == 0 {
		return
	}

	key := asMap(reaction["key"])
	if len(key) > 0 {
		copyCanonicalStringField(key, "id", "ID")
		copyCanonicalStringField(key, "remoteJid", "remoteJID")
	}
	copyCanonicalStringField(reaction, "senderTimestampMs", "senderTimestampMS")
}

func normalizeMessageAssociationPayload(messageMap map[string]any) {
	messageContextInfo := asMap(messageMap["messageContextInfo"])
	association := asMap(messageContextInfo["messageAssociation"])
	parentKey := asMap(association["parentMessageKey"])
	if len(parentKey) == 0 {
		return
	}
	copyCanonicalStringField(parentKey, "id", "ID")
	copyCanonicalStringField(parentKey, "remoteJid", "remoteJID")
}

func copyCanonicalStringField(target map[string]any, canonical string, aliases ...string) {
	if len(target) == 0 || stringValue(target[canonical]) != "" {
		return
	}
	for _, alias := range aliases {
		value, ok := target[alias]
		if !ok || stringValue(value) == "" {
			continue
		}
		target[canonical] = value
		return
	}
}

func (m *WhatsAppManager) buildIncomingMessageKey(evt *events.Message) map[string]any {
	key := map[string]any{
		"id":         evt.Info.ID,
		"remoteJid":  evt.Info.Chat.String(),
		"fromMe":     evt.Info.IsFromMe,
		"isViewOnce": incomingMessageIsViewOnce(evt),
	}
	if remoteJIDAlt := incomingRemoteJIDAlt(evt); remoteJIDAlt != "" {
		key["remoteJidAlt"] = remoteJIDAlt
	}
	if evt.Info.AddressingMode != "" {
		key["addressingMode"] = string(evt.Info.AddressingMode)
	}
	if !evt.Info.Sender.IsEmpty() && evt.Info.Sender != evt.Info.Chat {
		key["participant"] = evt.Info.Sender.String()
	}
	if !evt.Info.SenderAlt.IsEmpty() {
		key["participantAlt"] = evt.Info.SenderAlt.String()
	}
	return key
}

func incomingUpsertKafkaKey(cfg Config, upsert *UpsertMessage) string {
	if upsert == nil {
		return cfg.AccountID
	}

	accountID := firstNonEmpty(upsert.AccountID, cfg.AccountID)
	workerID := firstNonEmpty(upsert.WorkerID, cfg.WorkerID)
	messageKey := asMap(upsert.Message["key"])
	remoteKey := stableRemotePartitionKey(
		valueString(messageKey, "remoteJid"),
		valueString(messageKey, "remoteJidAlt"),
	)
	if remoteKey != "" {
		return fmt.Sprintf("%s:%s:%s", accountID, workerID, remoteKey)
	}

	messageID := valueString(messageKey, "id")
	if messageID != "" {
		return fmt.Sprintf("%s:%s", accountID, messageID)
	}

	return accountID
}

func stableRemotePartitionKey(remoteJID, remoteJIDAlt string) string {
	remoteJID = strings.ToLower(strings.TrimSpace(remoteJID))
	remoteJIDAlt = strings.ToLower(strings.TrimSpace(remoteJIDAlt))

	if remoteJID != "" && strings.HasSuffix(remoteJID, "@lid") && remoteJIDAlt != "" && !strings.HasSuffix(remoteJIDAlt, "@lid") {
		return remoteJIDAlt
	}
	if remoteJIDAlt != "" && !strings.HasSuffix(remoteJIDAlt, "@lid") {
		return remoteJIDAlt
	}
	if remoteJID != "" {
		return remoteJID
	}
	return remoteJIDAlt
}

func incomingMessageIsViewOnce(evt *events.Message) bool {
	if evt == nil {
		return false
	}
	if evt.IsViewOnce || evt.IsViewOnceV2 || evt.IsViewOnceV2Extension {
		return true
	}
	_, wrappedViewOnce := unwrapIncomingMessage(evt.Message)
	return wrappedViewOnce
}

func (m *WhatsAppManager) incomingProfilePhoto(ctx context.Context, evt *events.Message) string {
	return m.profilePhotoForJIDs(ctx, incomingProfilePhotoJIDs(evt))
}

func (m *WhatsAppManager) profilePhotoForJIDs(ctx context.Context, candidates []types.JID) string {
	client := m.getClient()
	if !m.isAuthenticated(client) {
		return ""
	}
	candidates = profilePhotoCandidates(candidates, ownProfilePhotoAliases(client))
	if len(candidates) == 0 {
		return ""
	}
	photoCtx, cancel := context.WithTimeout(ctx, whatsmeowPhotoFetchTimeout)
	defer cancel()

	for _, jid := range candidates {
		cacheKey := incomingProfilePhotoCacheKey(jid)
		if m.redis != nil {
			cachedPhoto, err := m.redis.Get(photoCtx, cacheKey).Result()
			switch {
			case err == nil && cachedPhoto != "":
				if cachedPhoto == whatsmeowPhotoCacheNoPhoto {
					continue
				}
				if !cachedProfilePhotoUsable(photoCtx, cachedPhoto) {
					log.Printf("whatsmeow shared profile photo cache is not usable worker_id=%s jid_hash=%s host=%s", m.cfg.WorkerID, hashConnectionFlowIdentifier(jid.String()), urlHost(cachedPhoto))
					continue
				}
				return cachedPhoto
			case err != nil && !errors.Is(err, redis.Nil):
				log.Printf("whatsmeow profile photo cache read failed worker_id=%s jid_hash=%s error_code=%s", m.cfg.WorkerID, hashConnectionFlowIdentifier(jid.String()), safeOperationalErrorCode(err))
			}
		}
	}

	for _, jid := range candidates {
		noPhotoCacheKey := incomingProfilePhotoNoPhotoCacheKey(jid)
		if m.redis != nil {
			cachedNoPhoto, err := m.redis.Get(photoCtx, noPhotoCacheKey).Result()
			switch {
			case err == nil && cachedNoPhoto == whatsmeowPhotoCacheNoPhoto:
				continue
			case err != nil && !errors.Is(err, redis.Nil):
				log.Printf("whatsmeow profile photo no-photo cache read failed worker_id=%s jid_hash=%s error_code=%s", m.cfg.WorkerID, hashConnectionFlowIdentifier(jid.String()), safeOperationalErrorCode(err))
			}
		}

		info, err := invokeWhatsmeowProviderOperationWithDeadline(
			photoCtx,
			m,
			client,
			"profile_photo:"+jid.String(),
			whatsmeowPhotoFetchTimeout,
			func(invokeCtx context.Context) (*types.ProfilePictureInfo, error) {
				return client.GetProfilePictureInfo(
					invokeCtx,
					jid,
					&whatsmeow.GetProfilePictureParams{Preview: false},
				)
			},
		)
		if err != nil {
			if errors.Is(err, whatsmeow.ErrProfilePictureNotSet) || errors.Is(err, whatsmeow.ErrProfilePictureUnauthorized) {
				m.cacheProfilePhotoNoPhoto(photoCtx, jid)
				continue
			}
			log.Printf("whatsmeow profile photo fetch failed worker_id=%s jid_hash=%s error_code=%s", m.cfg.WorkerID, hashConnectionFlowIdentifier(jid.String()), safeOperationalErrorCode(err))
			continue
		}
		if info == nil || strings.TrimSpace(info.URL) == "" {
			m.cacheProfilePhotoNoPhoto(photoCtx, jid)
			continue
		}
		photo := strings.TrimSpace(info.URL)
		m.cacheProfilePhoto(photoCtx, candidates, photo)
		log.Printf("whatsmeow profile photo fetched worker_id=%s jid_hash=%s photo_id_hash=%s persisted=false", m.cfg.WorkerID, hashConnectionFlowIdentifier(jid.String()), hashConnectionFlowIdentifier(info.ID))
		return photo
	}
	return ""
}

func (m *WhatsAppManager) persistProfilePhoto(ctx context.Context, jid types.JID, rawURL string) string {
	if rawURL == "" {
		return ""
	}
	if m.storage == nil {
		log.Printf("whatsmeow profile photo storage unavailable worker_id=%s jid_hash=%s using_raw_url=true", m.cfg.WorkerID, hashConnectionFlowIdentifier(jid.String()))
		return rawURL
	}
	body, contentType, fileName, err := downloadURL(ctx, rawURL)
	if err != nil {
		log.Printf("whatsmeow profile photo download failed worker_id=%s jid_hash=%s error_code=%s", m.cfg.WorkerID, hashConnectionFlowIdentifier(jid.String()), safeOperationalErrorCode(err))
		return rawURL
	}
	if !isImageContentType(contentType) {
		detected := http.DetectContentType(body)
		if isImageContentType(detected) {
			contentType = detected
		} else {
			log.Printf("whatsmeow profile photo ignored non-image worker_id=%s jid_hash=%s content_type=%s detected=%s", m.cfg.WorkerID, hashConnectionFlowIdentifier(jid.String()), contentType, detected)
			return ""
		}
	}
	if fileName == "" || fileName == "." || fileName == "/" {
		fileName = "profile_photo_" + firstNonEmpty(digits(jid.User), randomHex(4)) + extensionFromMime(contentType)
	}
	object, err := m.storage.Upload(ctx, m.cfg.AccountID, body, fileName, contentType)
	if err != nil {
		log.Printf("whatsmeow profile photo upload failed worker_id=%s jid_hash=%s error_code=%s", m.cfg.WorkerID, hashConnectionFlowIdentifier(jid.String()), safeOperationalErrorCode(err))
		return rawURL
	}
	log.Printf("whatsmeow profile photo uploaded worker_id=%s jid_hash=%s host=%s size=%d", m.cfg.WorkerID, hashConnectionFlowIdentifier(jid.String()), urlHost(object.URL), object.Size)
	return object.URL
}

func isImageContentType(contentType string) bool {
	return strings.HasPrefix(strings.ToLower(strings.TrimSpace(contentType)), "image/")
}

func urlHost(rawURL string) string {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return ""
	}
	return parsed.Host
}

func isLikelyTemporaryProfilePhotoURL(rawURL string) bool {
	host := strings.ToLower(urlHost(rawURL))
	return strings.Contains(host, "whatsapp.net") || strings.Contains(host, "fbcdn.net")
}

func cachedProfilePhotoUsable(ctx context.Context, rawURL string) bool {
	if !isLikelyTemporaryProfilePhotoURL(rawURL) {
		return true
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return false
	}
	req.Header.Set("Range", "bytes=0-0")

	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return false
	}
	defer res.Body.Close()

	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return false
	}

	contentType := strings.ToLower(strings.TrimSpace(res.Header.Get("content-type")))
	return contentType == "" || strings.HasPrefix(contentType, "image/")
}

func callAltJID(callFrom, creator types.JID) string {
	primary := nonADJID(callFrom)
	fallback := nonADJID(creator)
	if primary.IsEmpty() || fallback.IsEmpty() || primary == fallback {
		return ""
	}
	return fallback.String()
}

func callPhoneFromJIDs(callFrom, creator types.JID) string {
	candidates := []types.JID{nonADJID(callFrom), nonADJID(creator)}
	for _, jid := range candidates {
		if jid.Server != types.DefaultUserServer && jid.Server != types.LegacyUserServer {
			continue
		}
		if phone := digits(jid.User); phone != "" {
			return phone
		}
	}
	for _, jid := range candidates {
		if phone := digits(jid.User); phone != "" {
			return phone
		}
	}
	return ""
}

func (m *WhatsAppManager) cacheProfilePhoto(ctx context.Context, candidates []types.JID, photo string) {
	if m.redis == nil || strings.TrimSpace(photo) == "" {
		return
	}
	seen := map[string]struct{}{}
	for _, jid := range candidates {
		cacheKey := incomingProfilePhotoCacheKey(jid)
		if cacheKey == "" {
			continue
		}
		if _, ok := seen[cacheKey]; ok {
			continue
		}
		seen[cacheKey] = struct{}{}
		if err := m.redis.Set(ctx, cacheKey, photo, whatsmeowPhotoCacheTTL).Err(); err != nil {
			log.Printf("whatsmeow profile photo cache write failed worker_id=%s jid_hash=%s error_code=%s", m.cfg.WorkerID, hashConnectionFlowIdentifier(jid.String()), safeOperationalErrorCode(err))
		}
	}
}

func (m *WhatsAppManager) cacheProfilePhotoNoPhoto(ctx context.Context, jid types.JID) {
	cacheKey := incomingProfilePhotoNoPhotoCacheKey(jid)
	if m.redis == nil || cacheKey == "" {
		return
	}
	if err := m.redis.Set(ctx, cacheKey, whatsmeowPhotoCacheNoPhoto, whatsmeowPhotoCacheNoPhotoTTL).Err(); err != nil {
		log.Printf("whatsmeow profile photo no-photo cache write failed worker_id=%s error_code=%s", m.cfg.WorkerID, safeOperationalErrorCode(err))
	}
}

func incomingProfilePhotoJIDs(evt *events.Message) []types.JID {
	if evt == nil {
		return nil
	}
	if evt.Info.IsFromMe {
		return profilePhotoCandidates([]types.JID{
			evt.Info.RecipientAlt,
			evt.Info.SenderAlt,
			evt.Info.Chat,
			evt.Info.Sender,
		}, nil)
	}
	return profilePhotoCandidates([]types.JID{
		evt.Info.SenderAlt,
		evt.Info.RecipientAlt,
		evt.Info.Chat,
		evt.Info.Sender,
	}, nil)
}

func ownProfilePhotoAliases(client *whatsmeow.Client) map[string]struct{} {
	if client == nil || client.Store == nil {
		return nil
	}
	return profilePhotoAliasSet(client.Store.GetJID(), client.Store.GetLID())
}

func profilePhotoCandidates(candidates []types.JID, selfAliases map[string]struct{}) []types.JID {
	normalized := make([]types.JID, 0, len(candidates))
	seen := map[string]struct{}{}
	for _, jid := range candidates {
		jid = nonADJID(jid)
		if !isWhatsmeowUserChat(jid) {
			continue
		}
		if isSelfProfilePhotoJID(jid, selfAliases) {
			continue
		}
		key := jid.String()
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		normalized = append(normalized, jid)
	}
	return normalized
}

func profilePhotoAliasSet(jids ...types.JID) map[string]struct{} {
	aliases := map[string]struct{}{}
	for _, jid := range jids {
		for _, alias := range profilePhotoJIDAliases(jid) {
			aliases[alias] = struct{}{}
		}
	}
	if len(aliases) == 0 {
		return nil
	}
	return aliases
}

func isSelfProfilePhotoJID(jid types.JID, selfAliases map[string]struct{}) bool {
	if len(selfAliases) == 0 {
		return false
	}
	for _, alias := range profilePhotoJIDAliases(jid) {
		if _, ok := selfAliases[alias]; ok {
			return true
		}
	}
	return false
}

func profilePhotoJIDAliases(jid types.JID) []string {
	jid = nonADJID(jid)
	if !isWhatsmeowUserChat(jid) {
		return nil
	}
	aliases := []string{jid.String()}
	switch jid.Server {
	case types.DefaultUserServer:
		legacy := jid
		legacy.Server = types.LegacyUserServer
		aliases = append(aliases, legacy.String())
	case types.LegacyUserServer:
		current := jid
		current.Server = types.DefaultUserServer
		aliases = append(aliases, current.String())
	}
	return aliases
}

func incomingProfilePhotoCacheKey(jid types.JID) string {
	jid = nonADJID(jid)
	if jid.IsEmpty() {
		return ""
	}
	return whatsmeowPhotoCachePrefix + jid.String()
}

func incomingProfilePhotoNoPhotoCacheKey(jid types.JID) string {
	jid = nonADJID(jid)
	if jid.IsEmpty() {
		return ""
	}
	return whatsmeowPhotoNoPhotoCachePrefix + jid.String()
}

func (m *WhatsAppManager) logWhatsmeowEventDebug(ctx context.Context, evt any) {
	if !messageDebugEnabledForAccount(m.cfg, "") {
		return
	}

	switch event := evt.(type) {
	case *events.Message:
		m.logIncomingMessageDebug(
			ctx,
			event,
			incomingSkipReason(event),
		)
	case *events.HistorySync:
		conversations := 0
		statusMessages := 0
		syncType := ""
		progress := uint32(0)
		protobufBytes := 0
		if event != nil && event.Data != nil {
			conversations = len(event.Data.GetConversations())
			statusMessages = len(event.Data.GetStatusV3Messages())
			syncType = event.Data.GetSyncType().String()
			progress = event.Data.GetProgress()
			protobufBytes = proto.Size(event.Data)
		}
		log.Printf(
			"message_debug direction=in event_type=%T worker_id=%s account_id=%s history_sync_type=%q conversations=%d status_messages=%d progress=%d protobuf_bytes=%d",
			evt,
			m.cfg.WorkerID,
			m.cfg.AccountID,
			syncType,
			conversations,
			statusMessages,
			progress,
			protobufBytes,
		)
	case *events.Receipt:
		log.Printf(
			"message_debug direction=in event_type=%T worker_id=%s account_id=%s chat_hash=%s sender_hash=%s sender_alt_hash=%s id_hash=%s from_me=%t receipt_type=%s message_ids_hash=%s message_sender_hash=%s timestamp=%s",
			evt,
			m.cfg.WorkerID,
			m.cfg.AccountID,
			hashConnectionFlowIdentifier(jidString(event.Chat)),
			hashConnectionFlowIdentifier(jidString(event.Sender)),
			hashConnectionFlowIdentifier(jidString(event.SenderAlt)),
			"",
			event.IsFromMe,
			event.Type,
			hashConnectionFlowIdentifier(messageIDsDebugString(event.MessageIDs)),
			hashConnectionFlowIdentifier(jidString(event.MessageSender)),
			event.Timestamp.UTC().Format(time.RFC3339Nano),
		)
	case *events.CallOffer:
		log.Printf(
			"message_debug direction=in event_type=%T worker_id=%s account_id=%s chat_hash=%s sender_hash=%s id_hash=%s from_me=%t call_id_hash=%s call_creator_hash=%s call_creator_alt_hash=%s group_jid_hash=%s remote_platform=%s remote_version=%s timestamp=%s",
			evt,
			m.cfg.WorkerID,
			m.cfg.AccountID,
			hashConnectionFlowIdentifier(jidString(event.From)),
			hashConnectionFlowIdentifier(jidString(event.CallCreator)),
			hashConnectionFlowIdentifier(event.CallID),
			false,
			hashConnectionFlowIdentifier(event.CallID),
			hashConnectionFlowIdentifier(jidString(event.CallCreator)),
			hashConnectionFlowIdentifier(jidString(event.CallCreatorAlt)),
			hashConnectionFlowIdentifier(jidString(event.GroupJID)),
			event.RemotePlatform,
			event.RemoteVersion,
			event.Timestamp.UTC().Format(time.RFC3339Nano),
		)
	case *events.CallOfferNotice:
		log.Printf(
			"message_debug direction=in event_type=%T worker_id=%s account_id=%s chat_hash=%s sender_hash=%s id_hash=%s from_me=%t call_id_hash=%s call_creator_hash=%s call_creator_alt_hash=%s group_jid_hash=%s call_media=%s call_type=%s timestamp=%s",
			evt,
			m.cfg.WorkerID,
			m.cfg.AccountID,
			hashConnectionFlowIdentifier(jidString(event.From)),
			hashConnectionFlowIdentifier(jidString(event.CallCreator)),
			hashConnectionFlowIdentifier(event.CallID),
			false,
			hashConnectionFlowIdentifier(event.CallID),
			hashConnectionFlowIdentifier(jidString(event.CallCreator)),
			hashConnectionFlowIdentifier(jidString(event.CallCreatorAlt)),
			hashConnectionFlowIdentifier(jidString(event.GroupJID)),
			event.Media,
			event.Type,
			event.Timestamp.UTC().Format(time.RFC3339Nano),
		)
	case *events.ChatPresence:
		log.Printf(
			"message_debug direction=in event_type=%T worker_id=%s account_id=%s chat_hash=%s sender_hash=%s sender_alt_hash=%s id_hash=%s from_me=%t presence_state=%s presence_media=%s",
			evt,
			m.cfg.WorkerID,
			m.cfg.AccountID,
			hashConnectionFlowIdentifier(jidString(event.Chat)),
			hashConnectionFlowIdentifier(jidString(event.Sender)),
			hashConnectionFlowIdentifier(jidString(event.SenderAlt)),
			"",
			event.IsFromMe,
			event.State,
			event.Media,
		)
	default:
		log.Printf(
			"message_debug direction=in event_type=%T worker_id=%s account_id=%s payload_suppressed=true",
			evt,
			m.cfg.WorkerID,
			m.cfg.AccountID,
		)
	}
}

func (m *WhatsAppManager) logIncomingMessageDebug(ctx context.Context, evt *events.Message, skipReason string) {
	if !messageDebugEnabledForAccount(m.cfg, "") {
		return
	}

	log.Printf(
		"message_debug direction=in event_type=%T worker_id=%s account_id=%s chat_hash=%s sender_hash=%s sender_alt_hash=%s recipient_alt_hash=%s id_hash=%s from_me=%t category=%q info_type=%q media_type=%q edit=%q multicast=%t timestamp=%s retry_count=%d unavailable_request_id_hash=%s source_web_msg=%t is_ephemeral=%t is_view_once=%t is_view_once_v2=%t is_view_once_v2_extension=%t is_document_with_caption=%t is_lottie_sticker=%t is_bot_invoke=%t is_edit=%t kinds=%q message_text_bytes=%d protobuf_bytes=%d skip_reason=%q",
		evt,
		m.cfg.WorkerID,
		m.cfg.AccountID,
		hashConnectionFlowIdentifier(incomingChatString(evt)),
		hashConnectionFlowIdentifier(incomingSenderString(evt)),
		hashConnectionFlowIdentifier(incomingSenderAltString(evt)),
		hashConnectionFlowIdentifier(incomingRecipientAltString(evt)),
		hashConnectionFlowIdentifier(incomingMessageID(evt)),
		incomingFromMe(evt),
		incomingCategory(evt),
		incomingInfoType(evt),
		incomingMediaType(evt),
		incomingEdit(evt),
		incomingMulticast(evt),
		incomingTimestamp(evt),
		incomingRetryCount(evt),
		hashConnectionFlowIdentifier(incomingUnavailableRequestID(evt)),
		evt != nil && evt.SourceWebMsg != nil,
		evt != nil && evt.IsEphemeral,
		evt != nil && evt.IsViewOnce,
		evt != nil && evt.IsViewOnceV2,
		evt != nil && evt.IsViewOnceV2Extension,
		evt != nil && evt.IsDocumentWithCaption,
		evt != nil && evt.IsLottieSticker,
		evt != nil && evt.IsBotInvoke,
		evt != nil && evt.IsEdit,
		strings.Join(incomingMessageKinds(evt), ","),
		len([]byte(incomingTextPreview(evt))),
		incomingMessageProtoSize(evt),
		skipReason,
	)
}

func (m *WhatsAppManager) logIncomingMessageSummary(evt *events.Message, skipReason string) {
	log.Printf(
		"message_summary direction=in provider=whatsmeow event_type=%T worker_id=%s account_id=%s chat_hash=%s sender_hash=%s sender_alt_hash=%s recipient_alt_hash=%s id_hash=%s from_me=%t category=%q info_type=%q media_type=%q edit=%q timestamp=%s source_web_msg=%t is_view_once=%t is_edit=%t kinds=%q message_text_bytes=%d skip_reason=%q",
		evt,
		m.cfg.WorkerID,
		m.cfg.AccountID,
		hashConnectionFlowIdentifier(incomingChatString(evt)),
		hashConnectionFlowIdentifier(incomingSenderString(evt)),
		hashConnectionFlowIdentifier(incomingSenderAltString(evt)),
		hashConnectionFlowIdentifier(incomingRecipientAltString(evt)),
		hashConnectionFlowIdentifier(incomingMessageID(evt)),
		incomingFromMe(evt),
		incomingCategory(evt),
		incomingInfoType(evt),
		incomingMediaType(evt),
		incomingEdit(evt),
		incomingTimestamp(evt),
		evt != nil && evt.SourceWebMsg != nil,
		evt != nil && (evt.IsViewOnce || evt.IsViewOnceV2 || evt.IsViewOnceV2Extension),
		evt != nil && evt.IsEdit,
		strings.Join(incomingMessageKinds(evt), ","),
		len([]byte(incomingTextPreview(evt))),
		skipReason,
	)
}

func messageIDsDebugString(ids []types.MessageID) string {
	if len(ids) == 0 {
		return ""
	}
	parts := make([]string, 0, len(ids))
	for _, id := range ids {
		parts = append(parts, string(id))
	}
	return strings.Join(parts, ",")
}

func jidString(jid types.JID) string {
	if jid.IsEmpty() {
		return ""
	}
	return jid.String()
}

func incomingMessageKinds(evt *events.Message) []string {
	if evt == nil || evt.Message == nil {
		return []string{"empty"}
	}
	raw := evt.Message
	msg, _ := unwrapIncomingMessage(evt.Message)
	if msg == nil {
		return []string{"empty"}
	}
	kinds := make([]string, 0, 8)
	if raw.GetViewOnceMessage() != nil {
		kinds = append(kinds, "wrapper:view_once")
	}
	if raw.GetViewOnceMessageV2() != nil {
		kinds = append(kinds, "wrapper:view_once_v2")
	}
	if raw.GetViewOnceMessageV2Extension() != nil {
		kinds = append(kinds, "wrapper:view_once_v2_extension")
	}
	if raw.GetEphemeralMessage() != nil {
		kinds = append(kinds, "wrapper:ephemeral")
	}
	if raw.GetDocumentWithCaptionMessage() != nil {
		kinds = append(kinds, "wrapper:document_with_caption")
	}
	if raw.GetLottieStickerMessage() != nil {
		kinds = append(kinds, "wrapper:lottie_sticker")
	}
	if raw.GetEditedMessage() != nil {
		kinds = append(kinds, "wrapper:edited")
	}
	if msg.GetConversation() != "" {
		kinds = append(kinds, "conversation")
	}
	if msg.GetExtendedTextMessage() != nil {
		kinds = append(kinds, "extended_text")
	}
	if msg.GetTemplateMessage() != nil {
		kinds = append(kinds, "template")
	}
	if hsm := msg.GetHighlyStructuredMessage(); hsm != nil {
		if hsm.GetHydratedHsm() != nil {
			kinds = append(kinds, "hsm:hydrated")
		} else {
			kinds = append(kinds, "hsm")
		}
	}
	if msg.GetInteractiveMessage() != nil {
		kinds = append(kinds, "interactive")
	}
	if protocolMsg := msg.GetProtocolMessage(); protocolMsg != nil {
		if protocolMsg.Type == nil {
			kinds = append(kinds, "protocol:unknown")
		} else {
			kinds = append(kinds, "protocol:"+protocolMsg.GetType().String())
		}
	}
	if msg.GetReactionMessage() != nil {
		kinds = append(kinds, "reaction")
	}
	if msg.GetImageMessage() != nil {
		kinds = append(kinds, "image")
	}
	if msg.GetVideoMessage() != nil {
		kinds = append(kinds, "video")
	}
	if msg.GetPtvMessage() != nil {
		kinds = append(kinds, "ptv")
	}
	if msg.GetAudioMessage() != nil {
		kinds = append(kinds, "audio")
	}
	if msg.GetDocumentMessage() != nil {
		kinds = append(kinds, "document")
	}
	if msg.GetStickerMessage() != nil {
		kinds = append(kinds, "sticker")
	}
	if msg.GetLocationMessage() != nil {
		kinds = append(kinds, "location")
	}
	if msg.GetContactMessage() != nil {
		kinds = append(kinds, "contact")
	}
	if msg.GetContactsArrayMessage() != nil {
		kinds = append(kinds, "contacts")
	}
	if msg.GetDeviceSentMessage() != nil {
		kinds = append(kinds, "device_sent")
	}
	if msg.GetViewOnceMessage() != nil {
		kinds = append(kinds, "view_once")
	}
	if msg.GetViewOnceMessageV2() != nil {
		kinds = append(kinds, "view_once_v2")
	}
	if msg.GetViewOnceMessageV2Extension() != nil {
		kinds = append(kinds, "view_once_v2_extension")
	}
	if msg.GetEphemeralMessage() != nil {
		kinds = append(kinds, "ephemeral")
	}
	if msg.GetDocumentWithCaptionMessage() != nil {
		kinds = append(kinds, "document_with_caption")
	}
	if msg.GetAlbumMessage() != nil {
		kinds = append(kinds, "album")
	}
	if msg.GetPollCreationMessage() != nil || msg.GetPollCreationMessageV2() != nil || msg.GetPollCreationMessageV3() != nil || msg.GetPollCreationMessageV5() != nil || msg.GetPollCreationMessageV6() != nil {
		kinds = append(kinds, "poll_creation")
	}
	if msg.GetPollUpdateMessage() != nil {
		kinds = append(kinds, "poll_update")
	}
	if msg.GetPinInChatMessage() != nil {
		kinds = append(kinds, "pin_in_chat")
	}
	if msg.GetKeepInChatMessage() != nil {
		kinds = append(kinds, "keep_in_chat")
	}
	if len(kinds) == 0 {
		kinds = append(kinds, "unknown")
	}
	return kinds
}

func incomingTextPreview(evt *events.Message) string {
	if evt == nil || evt.Message == nil {
		return ""
	}
	msg, _ := unwrapIncomingMessage(evt.Message)
	if msg == nil {
		return ""
	}
	candidates := []string{
		msg.GetConversation(),
	}
	if ext := msg.GetExtendedTextMessage(); ext != nil {
		candidates = append(candidates, ext.GetText())
	}
	if template := msg.GetTemplateMessage(); template != nil {
		if hydrated := template.GetHydratedTemplate(); hydrated != nil {
			candidates = append(candidates, hydrated.GetHydratedContentText())
		}
		if hydrated := template.GetHydratedFourRowTemplate(); hydrated != nil {
			candidates = append(candidates, hydrated.GetHydratedContentText())
		}
	}
	if hsm := msg.GetHighlyStructuredMessage(); hsm != nil {
		if template := hsm.GetHydratedHsm(); template != nil {
			if hydrated := template.GetHydratedTemplate(); hydrated != nil {
				candidates = append(candidates, hydrated.GetHydratedContentText())
			}
			if hydrated := template.GetHydratedFourRowTemplate(); hydrated != nil {
				candidates = append(candidates, hydrated.GetHydratedContentText())
			}
		}
	}
	if interactive := msg.GetInteractiveMessage(); interactive != nil {
		candidates = append(candidates, interactive.GetBody().GetText())
	}
	if reaction := msg.GetReactionMessage(); reaction != nil {
		candidates = append(candidates, reaction.GetText())
	}
	if image := msg.GetImageMessage(); image != nil {
		candidates = append(candidates, image.GetCaption())
	}
	if video := msg.GetVideoMessage(); video != nil {
		candidates = append(candidates, video.GetCaption())
	}
	if doc := msg.GetDocumentMessage(); doc != nil {
		candidates = append(candidates, doc.GetCaption(), doc.GetFileName(), doc.GetTitle())
	}
	for _, candidate := range candidates {
		candidate = strings.TrimSpace(candidate)
		if candidate != "" {
			return truncateLogValue(candidate, 500)
		}
	}
	return ""
}

func truncateLogValue(value string, limit int) string {
	if limit <= 0 || len(value) <= limit {
		return value
	}
	return value[:limit] + "...<truncated>"
}

func incomingSkipReason(evt *events.Message) string {
	return incomingSkipReasonWithHistory(evt, false)
}

func incomingSkipReasonWithHistory(evt *events.Message, allowHistorySync bool) string {
	if evt == nil || evt.Message == nil {
		return "empty_message"
	}
	if strings.EqualFold(evt.Info.Category, "peer") {
		return "peer_category"
	}
	if !allowHistorySync && evt.SourceWebMsg != nil && evt.UnavailableRequestID == "" {
		return "history_sync_message"
	}
	if evt.Info.IsIncomingBroadcast() {
		return "incoming_broadcast"
	}
	if !isWhatsmeowUserChat(evt.Info.Chat) {
		return "non_user_chat"
	}
	return ""
}

func historySyncMessageTimestamp(message *waHistorySync.HistorySyncMsg) uint64 {
	if message == nil || message.GetMessage() == nil {
		return 0
	}
	return message.GetMessage().GetMessageTimestamp()
}

func incomingRemoteJIDAlt(evt *events.Message) string {
	if evt == nil {
		return ""
	}
	altCandidates := []types.JID{}
	if evt.Info.IsFromMe {
		altCandidates = append(altCandidates, evt.Info.RecipientAlt, evt.Info.SenderAlt)
	} else {
		altCandidates = append(altCandidates, evt.Info.SenderAlt, evt.Info.RecipientAlt)
	}
	chat := nonADJID(evt.Info.Chat)
	for _, candidate := range altCandidates {
		alt := nonADJID(candidate)
		if alt.IsEmpty() || alt == chat {
			continue
		}
		return alt.String()
	}
	return ""
}

func nonADJID(jid types.JID) types.JID {
	if jid.IsEmpty() {
		return jid
	}
	return jid.ToNonAD()
}

func isWhatsmeowUserChat(jid types.JID) bool {
	if jid.User == "" {
		return false
	}
	switch jid.Server {
	case types.DefaultUserServer, types.HiddenUserServer, types.LegacyUserServer:
		return true
	default:
		return false
	}
}

func incomingChatString(evt *events.Message) string {
	if evt == nil {
		return ""
	}
	return evt.Info.Chat.String()
}

func incomingSenderString(evt *events.Message) string {
	if evt == nil {
		return ""
	}
	return evt.Info.Sender.String()
}

func incomingSenderAltString(evt *events.Message) string {
	if evt == nil {
		return ""
	}
	return evt.Info.SenderAlt.String()
}

func incomingRecipientAltString(evt *events.Message) string {
	if evt == nil {
		return ""
	}
	return evt.Info.RecipientAlt.String()
}

func incomingMessageID(evt *events.Message) string {
	if evt == nil {
		return ""
	}
	return string(evt.Info.ID)
}

func incomingFromMe(evt *events.Message) bool {
	if evt == nil {
		return false
	}
	return evt.Info.IsFromMe
}

func incomingCategory(evt *events.Message) string {
	if evt == nil {
		return ""
	}
	return evt.Info.Category
}

func incomingChatServer(evt *events.Message) string {
	if evt == nil {
		return ""
	}
	return evt.Info.Chat.Server
}

func incomingInfoType(evt *events.Message) string {
	if evt == nil {
		return ""
	}
	return evt.Info.Type
}

func incomingMediaType(evt *events.Message) string {
	if evt == nil {
		return ""
	}
	return evt.Info.MediaType
}

func incomingEdit(evt *events.Message) string {
	if evt == nil {
		return ""
	}
	return string(evt.Info.Edit)
}

func incomingMulticast(evt *events.Message) bool {
	if evt == nil {
		return false
	}
	return evt.Info.Multicast
}

func incomingServerID(evt *events.Message) int {
	if evt == nil {
		return 0
	}
	return evt.Info.ServerID
}

func incomingTimestamp(evt *events.Message) string {
	if evt == nil || evt.Info.Timestamp.IsZero() {
		return ""
	}
	return evt.Info.Timestamp.Format(time.RFC3339Nano)
}

func incomingRetryCount(evt *events.Message) int {
	if evt == nil {
		return 0
	}
	return evt.RetryCount
}

func incomingUnavailableRequestID(evt *events.Message) string {
	if evt == nil {
		return ""
	}
	return string(evt.UnavailableRequestID)
}

var digitsRE = regexp.MustCompile(`\D+`)

func digits(value string) string {
	return digitsRE.ReplaceAllString(value, "")
}

func phoneFromJID(jid string) string {
	user := strings.Split(jid, "@")[0]
	if strings.Contains(user, ":") {
		user = strings.Split(user, ":")[0]
	}
	return digits(user)
}

func phoneFromOwnID(jid *types.JID) string {
	if jid == nil {
		return ""
	}
	return digits(jid.User)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
