package app

import (
	"context"
	cryptorand "crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/segmentio/kafka-go"
	"go.mau.fi/whatsmeow/types"
)

type Worker struct {
	cfg                               Config
	kafka                             *KafkaClient
	workerCommands                    *WorkerCommandNATSClient
	redis                             *redis.Client
	postgres                          *WorkerPostgres
	centrifugo                        *CentrifugoClient
	storage                           *StorageClient
	whatsapp                          *WhatsAppManager
	grpcServer                        *WorkerConnectionGRPCServer
	debug                             *ConnectionLifecycleDebugLogger
	httpServer                        *http.Server
	cancel                            context.CancelFunc
	shutdown                          sync.Once
	runtimeMu                         sync.RWMutex
	runCtx                            context.Context
	runtimeCancel                     context.CancelFunc
	runtimeStarted                    bool
	outboundRecoveryPublisher         func(context.Context, outboundRecoveryRecord) error
	outboundRecoveryScopeCapturer     func(context.Context) (whatsAppRuntimeFence, error)
	workerConfigRevisionValidator     func(context.Context, string, string) (bool, error)
	integrationEntitlementAllowed     atomic.Uint64
	integrationEntitlementDenied      atomic.Uint64
	integrationEntitlementUnavailable atomic.Uint64
	integrationEntitlementSuppressed  atomic.Uint64
	kafkaConsumersReady               atomic.Bool
	kafkaConsumersAuthorized          atomic.Bool
	kafkaConsumersStarted             atomic.Bool
	kafkaConsumerBarrierEpoch         atomic.Uint64
	kafkaDispatchMu                   sync.RWMutex
	kafkaConsumerRestart              chan struct{}
	kafkaConsumerRepairMu             sync.Mutex
	kafkaConsumerRepairAttempts       int
	kafkaConsumerLastRepairAt         time.Time
	runtimeEffectLeasesRequired       bool
	providerSendAdmissionOnce         sync.Once
	providerSendAdmission             chan struct{}
	databaseGuardOnce                 sync.Once
	databaseSuspended                 atomic.Bool
	providerHandoffBlocked            atomic.Bool
	providerHandoffMu                 sync.Mutex
	providerHandoffKey                string
	providerHandoffFlight             *workerProviderHandoffFlight
	providerHandoffResult             *ProviderHandoffPrepareResponse
	sessionMigrationMu                sync.Mutex
	sessionMigrationID                string
	sessionMigrationPhone             string
	sessionMigrationResult            *SessionStorageMigrationPrepareResponse
	// startWorkerCommandConsumer is a deterministic supervisor-test seam.
	// Production always leaves it nil and binds WorkerCommandNATSClient.
	startWorkerCommandConsumer func(context.Context, *Worker, KafkaConsumerLifecycleObserver) (KafkaConsumerHandle, error)
}

func resolveWhatsmeowRuntimeFenceBootstrap(
	ctx context.Context,
	postgres *WorkerPostgres,
	cfg Config,
) (Config, WhatsappRuntimeFenceActivationRequest, error) {
	if postgres == nil || postgres.DB == nil {
		return cfg, WhatsappRuntimeFenceActivationRequest{}, errors.New("worker database is required for runtime fence bootstrap")
	}
	owned, err := postgres.ResolveOwnedRuntimeConnectionFence(ctx, cfg, "whatsmeow")
	if err != nil {
		return cfg, WhatsappRuntimeFenceActivationRequest{}, err
	}
	return whatsmeowRuntimeFenceBootstrap(cfg, owned, uuid.NewString)
}

func whatsmeowRuntimeFenceBootstrap(
	cfg Config,
	owned *WhatsappRuntimeOwnedConnectionFence,
	randomEpoch func() string,
) (Config, WhatsappRuntimeFenceActivationRequest, error) {
	connectionEpoch, connectionAttemptID, err := runtimeFenceActivationIdentity(
		owned,
		randomEpoch,
	)
	if err != nil {
		return cfg, WhatsappRuntimeFenceActivationRequest{}, err
	}
	request := WhatsappRuntimeFenceActivationRequest{
		WorkerID:            cfg.WorkerID,
		AccountID:           cfg.AccountID,
		SourceProvider:      "whatsmeow",
		RuntimeGeneration:   cfg.RuntimeGeneration,
		ConnectionEpoch:     connectionEpoch,
		ConnectionAttemptID: connectionAttemptID,
	}
	if owned == nil {
		cfg.OwnedConnectionEpoch = ""
		cfg.OwnedConnectionAttemptID = ""
		return cfg, request, nil
	}

	cfg.OwnedConnectionEpoch = connectionEpoch
	cfg.OwnedConnectionAttemptID = connectionAttemptID
	return cfg, request, nil
}

func activateWhatsmeowBootstrapRuntimeFence(
	ctx context.Context,
	postgres *WorkerPostgres,
	cfg Config,
	request WhatsappRuntimeFenceActivationRequest,
) (Config, error) {
	_, err := postgres.ActivateRuntimeFence(ctx, cfg, request)
	return whatsmeowBootstrapRuntimeFenceActivationResult(cfg, err)
}

func whatsmeowBootstrapRuntimeFenceActivationResult(
	cfg Config,
	err error,
) (Config, error) {
	if err == nil {
		cfg.DeferAuthStoreInitialization = false
		return cfg, nil
	}
	if errors.Is(err, errWhatsAppRuntimeFenceActivationRejected) {
		// A disconnect tombstone intentionally rejects a same-generation random
		// or previously consumed epoch. Keep the control plane and QR stream alive
		// without touching the auth store; a later pending grant is the only event
		// allowed to wake this provider runtime.
		cfg.DeferAuthStoreInitialization = true
		return cfg, nil
	}
	return cfg, err
}

// workerRuntimeActivationAttempt owns every resource whose lifetime begins
// while a warm worker is being promoted to an active runtime. Keeping cleanup
// behind one sync.Once makes all failure paths safe to compose without risking
// a second provider shutdown or lease release.
type workerRuntimeActivationAttempt struct {
	ctx         context.Context
	cancel      context.CancelFunc
	cleanupOnce sync.Once
	cleanupErr  error
}

func newWorkerRuntimeActivationAttempt(parent context.Context) *workerRuntimeActivationAttempt {
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithCancel(parent)
	return &workerRuntimeActivationAttempt{
		ctx:    ctx,
		cancel: cancel,
	}
}

func (a *workerRuntimeActivationAttempt) cleanup(manager *WhatsAppManager) error {
	if a == nil {
		return nil
	}
	a.cleanupOnce.Do(func() {
		a.cancel()
		if manager == nil {
			return
		}
		cleanupCtx, cleanupCancel := context.WithTimeout(
			context.Background(),
			workerDatabaseRecoveryTimeout,
		)
		defer cleanupCancel()
		a.cleanupErr = manager.Close(cleanupCtx)
	})
	return a.cleanupErr
}

type kafkaDispatchAuthorizationContextKey struct{}

type kafkaDispatchAuthorization struct {
	worker      *Worker
	epoch       uint64
	effectLease *whatsAppRuntimeEffectLease
}

var errKafkaConsumerDispatchRevoked = errors.New("kafka consumer dispatch authorization revoked")
var errOutboundProviderAdmissionUnavailable = errors.New("outbound provider admission unavailable")

const (
	connectionQRCodeCacheTTL                     = 115 * time.Second
	connectionQRCodeMaxAge                       = 120 * time.Second
	integrationPlanProductID                     = "0eb84ca1-8145-4770-acd4-b6725fe1cf25"
	consumerOnlineAuthorizationRetryBaseDelay    = time.Second
	consumerOnlineAuthorizationRetryMaximumDelay = 30 * time.Second
)

var (
	integrationEntitlementRetryDelays = []time.Duration{100 * time.Millisecond, 300 * time.Millisecond, 700 * time.Millisecond}
)

const connectionQRCodeAttemptCompareAndCacheScript = `
-- whatsmeow_qr_active_attempt_compare_and_cache_v1
local raw = redis.call('GET', KEYS[1])
if not raw or redis.call('EXISTS', KEYS[3]) == 1 then
  return 0
end

local decoded_ok, envelope = pcall(cjson.decode, raw)
if not decoded_ok or type(envelope) ~= 'table' or type(envelope['ack']) ~= 'table' then
  return 0
end

local ack = envelope['ack']
if tostring(ack['connection_attempt_id'] or '') ~= ARGV[1] then
  return 0
end

local function exact_field(field_name, expected, required)
  local envelope_value = envelope[field_name]
  local ack_value = ack[field_name]
  if envelope_value ~= nil and tostring(envelope_value) ~= expected then
    return false
  end
  if ack_value ~= nil and tostring(ack_value) ~= expected then
    return false
  end
  if required and envelope_value == nil and ack_value == nil then
    return false
  end
  return true
end

if not exact_field('worker_type_id', ARGV[2], true) or
   not exact_field('runtime_generation', ARGV[3], ARGV[3] ~= '') or
   not exact_field('authorized_connection_epoch', ARGV[4], ARGV[4] ~= '') then
  return 0
end

if ARGV[5] == 'cache' then
  redis.call('SET', KEYS[2], ARGV[6], 'PX', ARGV[7])
end
return 1
`

type integrationEntitlementCacheEntry struct {
	AccountID     string  `json:"account_id"`
	PlanProductID string  `json:"plan_product_id"`
	Allowed       *bool   `json:"allowed"`
	Revision      string  `json:"revision"`
	ValidUntil    *string `json:"valid_until"`
	PlanIsActive  *bool   `json:"plan_is_active"`
	Source        *string `json:"source"`
}

func (w *Worker) integrationEntitlementTelemetrySnapshot() map[string]uint64 {
	return map[string]uint64{
		"allowed":     w.integrationEntitlementAllowed.Load(),
		"denied":      w.integrationEntitlementDenied.Load(),
		"unavailable": w.integrationEntitlementUnavailable.Load(),
		"suppressed":  w.integrationEntitlementSuppressed.Load(),
	}
}

func isPositiveDecimalRevision(value string) bool {
	if value == "" || value == "0" {
		return false
	}
	for _, character := range value {
		if character < '0' || character > '9' {
			return false
		}
	}
	return true
}

func decodeIntegrationEntitlementCacheEntry(value, accountID string) (integrationEntitlementCacheEntry, error) {
	var entitlement integrationEntitlementCacheEntry
	if err := json.Unmarshal([]byte(value), &entitlement); err != nil {
		return entitlement, fmt.Errorf("decode plan entitlement cache: %w", err)
	}
	if entitlement.AccountID != accountID ||
		entitlement.PlanProductID != integrationPlanProductID ||
		entitlement.Allowed == nil ||
		entitlement.PlanIsActive == nil ||
		!isPositiveDecimalRevision(entitlement.Revision) {
		return entitlement, errors.New("plan entitlement cache has an invalid structure")
	}
	if entitlement.ValidUntil != nil {
		if _, err := time.Parse(time.RFC3339Nano, *entitlement.ValidUntil); err != nil {
			return entitlement, fmt.Errorf("decode plan entitlement validity: %w", err)
		}
	}
	if *entitlement.Allowed {
		if entitlement.Source == nil || (*entitlement.Source != "plan" && *entitlement.Source != "addon") {
			return entitlement, errors.New("allowed plan entitlement cache is missing a valid grant source")
		}
	} else if entitlement.Source != nil {
		return entitlement, errors.New("denied plan entitlement cache must not declare a grant source")
	}
	return entitlement, nil
}

func integrationEntitlementCacheKey(accountID string) string {
	return "plan-entitlement:v1:epoch:" + accountID + ":" + integrationPlanProductID
}

func integrationEntitlementDenyKey(accountID string) string {
	return "plan-entitlement:v1:deny:" + accountID + ":" + integrationPlanProductID
}

func (w *Worker) hasCurrentIntegrationEntitlement(ctx context.Context, accountID, expectedRevision, stage, eventID string) (bool, string, error) {
	var lastErr error
	for attempt := 0; attempt <= len(integrationEntitlementRetryDelays); attempt++ {
		allowed, source, err := w.readCurrentIntegrationEntitlement(ctx, accountID, expectedRevision, stage, eventID)
		if err == nil {
			if allowed {
				w.integrationEntitlementAllowed.Add(1)
			} else {
				w.integrationEntitlementDenied.Add(1)
				w.integrationEntitlementSuppressed.Add(1)
			}
			return allowed, source, nil
		}
		lastErr = err
		if attempt == len(integrationEntitlementRetryDelays) {
			break
		}
		timer := time.NewTimer(integrationEntitlementRetryDelays[attempt])
		select {
		case <-ctx.Done():
			timer.Stop()
			return false, "", ctx.Err()
		case <-timer.C:
		}
	}
	w.integrationEntitlementUnavailable.Add(1)
	return false, "", fmt.Errorf("plan entitlement validation retries exhausted: %w", lastErr)
}

func logIntegrationEntitlementDrop(stage, accountID, workerID, expectedRevision, actualRevision, source, eventID string) {
	log.Printf(
		"plan_entitlement_audit surface=inbound_worker outcome=suppressed reason=integration_entitlement_missing stage=%s account_id=%s worker_id=%s plan_product_id=%s expected_revision=%s actual_revision=%s source=%s event_id=%s",
		stage,
		accountID,
		workerID,
		integrationPlanProductID,
		expectedRevision,
		actualRevision,
		source,
		eventID,
	)
}

func integrationEntitlementSource(entitlement integrationEntitlementCacheEntry) string {
	if entitlement.Source == nil {
		return ""
	}
	return *entitlement.Source
}

func (w *Worker) readCurrentIntegrationEntitlement(ctx context.Context, accountID, expectedRevision, stage, eventID string) (bool, string, error) {
	if accountID == "" || expectedRevision == "" {
		logIntegrationEntitlementDrop(stage, accountID, w.cfg.WorkerID, expectedRevision, "", "", eventID)
		return false, "", nil
	}
	if w.redis == nil {
		return false, "", errors.New("plan entitlement cache unavailable")
	}

	denyValue, err := w.redis.Get(ctx, integrationEntitlementDenyKey(accountID)).Result()
	if err == nil && denyValue != "" {
		entitlement, decodeErr := decodeIntegrationEntitlementCacheEntry(denyValue, accountID)
		if decodeErr != nil {
			return false, "", fmt.Errorf("decode plan entitlement deny fence: %w", decodeErr)
		}
		logIntegrationEntitlementDrop(stage, accountID, w.cfg.WorkerID, expectedRevision, entitlement.Revision, integrationEntitlementSource(entitlement), eventID)
		return false, "", nil
	}
	if err != nil && !errors.Is(err, redis.Nil) {
		return false, "", fmt.Errorf("read plan entitlement deny fence: %w", err)
	}

	value, err := w.redis.Get(ctx, integrationEntitlementCacheKey(accountID)).Result()
	if errors.Is(err, redis.Nil) {
		return false, "", errors.New("plan entitlement cache miss")
	}
	if err != nil {
		return false, "", fmt.Errorf("read plan entitlement cache: %w", err)
	}

	entitlement, err := decodeIntegrationEntitlementCacheEntry(value, accountID)
	if err != nil {
		return false, "", err
	}

	isCurrent := *entitlement.Allowed && *entitlement.PlanIsActive &&
		entitlement.Revision == expectedRevision
	if isCurrent && entitlement.ValidUntil == nil {
		return false, "", errors.New("plan entitlement cache missing validity")
	}
	if isCurrent && entitlement.ValidUntil != nil {
		validUntil, parseErr := time.Parse(time.RFC3339Nano, *entitlement.ValidUntil)
		if parseErr != nil {
			return false, "", fmt.Errorf("decode plan entitlement validity: %w", parseErr)
		}
		isCurrent = validUntil.After(time.Now())
	}

	if !isCurrent {
		logIntegrationEntitlementDrop(stage, accountID, w.cfg.WorkerID, expectedRevision, entitlement.Revision, integrationEntitlementSource(entitlement), eventID)
	}
	if !isCurrent || entitlement.Source == nil {
		return isCurrent, "", nil
	}
	return true, *entitlement.Source, nil
}

func NewWorker(ctx context.Context, cfg Config) (*Worker, error) {
	log.Printf("worker startup stage=postgres_open")
	postgres, err := OpenWorkerPostgres(ctx, cfg)
	if err != nil {
		return nil, wrapSafeOperationalError(safeCodeStartupPostgresOpenFailed, err)
	}
	initialized := false
	defer func() {
		if !initialized && postgres != nil {
			closeCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			_ = postgres.Close(closeCtx)
		}
	}()
	if cfg.WarmStandby {
		log.Printf("worker startup stage=warm_runtime_hydrate")
		var hydrated bool
		cfg, hydrated, err = postgres.HydrateWarmRuntime(ctx, cfg)
		if err != nil {
			return nil, wrapSafeOperationalError(safeCodeStartupWarmHydrateFailed, err)
		}
		if hydrated {
			log.Printf("worker warm runtime assignment hydrated warm_pool_id=%s worker_id=%s", cfg.WarmPoolID, cfg.WorkerID)
		}
	}
	// A fresh warm standby never connects to the command stream, but preserves
	// the static runtime identity so activation does not need to transport a
	// secret. A hydrated assignment is no longer standby and follows the
	// cold-start path.
	cfg = warmStandbyNATSConfig(cfg)
	if !cfg.WarmStandby {
		log.Printf("worker startup stage=runtime_fence_activate")
		var activationRequest WhatsappRuntimeFenceActivationRequest
		cfg, activationRequest, err = resolveWhatsmeowRuntimeFenceBootstrap(ctx, postgres, cfg)
		if err != nil {
			return nil, wrapSafeOperationalError(safeCodeStartupRuntimeFenceActivateFailed, err)
		}
		cfg, err = activateWhatsmeowBootstrapRuntimeFence(
			ctx,
			postgres,
			cfg,
			activationRequest,
		)
		if err != nil {
			return nil, wrapSafeOperationalError(safeCodeStartupRuntimeFenceActivateFailed, err)
		}
	}
	log.Printf("worker startup stage=kafka_create")
	log.Printf("initializing kafka client brokers=%s protocol=%s", strings.Join(cfg.KafkaBrokers, ","), cfg.KafkaProtocol)
	kafkaClient, err := NewKafkaClient(cfg)
	if err != nil {
		return nil, wrapSafeOperationalError(safeCodeStartupKafkaCreateFailed, err)
	}
	var workerCommands *WorkerCommandNATSClient
	if !cfg.WarmStandby {
		log.Printf("worker startup stage=jetstream_command_ingress_create")
		workerCommands, err = NewWorkerCommandNATSClient(ctx, cfg)
		if err != nil {
			_ = kafkaClient.Close()
			return nil, fmt.Errorf("initialize mandatory JetStream command ingress: %w", err)
		}
	}
	defer func() {
		if !initialized {
			if workerCommands != nil {
				workerCommands.Close()
			}
			_ = kafkaClient.Close()
		}
	}()
	log.Printf("worker startup stage=redis_create")
	log.Printf("initializing redis client addr=%s:%d", cfg.RedisHost, cfg.RedisPort)
	redisClient := redis.NewClient(&redis.Options{
		Addr:         cfg.RedisHost + ":" + strconv.Itoa(cfg.RedisPort),
		Password:     cfg.RedisPassword,
		DialTimeout:  outboundRedisOperationTimeout,
		ReadTimeout:  outboundRedisOperationTimeout,
		WriteTimeout: outboundRedisOperationTimeout,
		PoolTimeout:  outboundRedisOperationTimeout,
		MaxRetries:   1,
	})
	debug := NewConnectionLifecycleDebugLogger(cfg.ConnectionLifecycleDebugEnabled, redisClient)
	centrifugo := NewCentrifugoClient(cfg)
	log.Printf("worker startup stage=storage_create")
	storage, err := NewStorageClient(cfg, postgres)
	if err != nil {
		return nil, wrapSafeOperationalError(safeCodeStartupStorageCreateFailed, err)
	}
	var whatsApp *WhatsAppManager
	if !cfg.WarmStandby {
		log.Printf("worker startup stage=whatsapp_manager_create")
		whatsApp, err = NewWhatsAppManager(ctx, cfg, kafkaClient, centrifugo, storage, redisClient, postgres, debug)
		if err != nil {
			return nil, err
		}
	}
	worker := &Worker{
		cfg:                         cfg,
		kafka:                       kafkaClient,
		workerCommands:              workerCommands,
		redis:                       redisClient,
		postgres:                    postgres,
		centrifugo:                  centrifugo,
		storage:                     storage,
		whatsapp:                    whatsApp,
		debug:                       debug,
		kafkaConsumerRestart:        make(chan struct{}, 1),
		runtimeEffectLeasesRequired: true,
	}
	worker.kafkaConsumerBarrierEpoch.Store(initialKafkaConsumerBarrierEpoch())
	if whatsApp != nil {
		whatsApp.setConsumerBarrierCallbacks(func() bool {
			return worker.kafkaConsumersReady.Load()
		}, func() {
			worker.invalidateKafkaConsumerBarrier()
		})
	}
	log.Printf("worker startup stage=grpc_bridge_create")
	grpcServer, err := NewWorkerConnectionGRPCServer(cfg.GRPCAddr, worker, cfg, debug)
	if err != nil {
		return nil, wrapSafeOperationalError(safeCodeStartupGRPCBridgeCreateFailed, err)
	}
	worker.grpcServer = grpcServer
	initialized = true
	return worker, nil
}

func (w *Worker) Run(ctx context.Context) error {
	runCtx, cancel := context.WithCancel(ctx)
	w.cancel = cancel
	w.runCtx = runCtx

	log.Printf("worker run starting worker_id=%s", w.cfg.WorkerID)
	if err := w.startHTTP(); err != nil {
		return err
	}
	if err := w.grpcServer.Start(); err != nil {
		return err
	}
	if w.cfg.WarmStandby {
		log.Printf("worker warm standby ready warm_pool_id=%s worker_id=%s", w.cfg.WarmPoolID, w.cfg.WorkerID)
		<-runCtx.Done()
		log.Printf("worker warm standby stopping worker_id=%s reason=%v", w.cfg.WorkerID, runCtx.Err())
		return runCtx.Err()
	}
	if err := w.startActivatedRuntime(runCtx); err != nil {
		return err
	}
	log.Printf("worker run ready worker_id=%s", w.cfg.WorkerID)

	<-runCtx.Done()
	log.Printf("worker run stopping worker_id=%s reason=%v", w.cfg.WorkerID, runCtx.Err())
	return runCtx.Err()
}

func (w *Worker) Shutdown(ctx context.Context) error {
	var err error
	w.shutdown.Do(func() {
		if w.cancel != nil {
			w.cancel()
		}
		w.runtimeMu.Lock()
		runtimeCancel := w.runtimeCancel
		w.runtimeCancel = nil
		whatsApp := w.whatsapp
		w.runtimeMu.Unlock()
		if runtimeCancel != nil {
			runtimeCancel()
		}
		if w.grpcServer != nil {
			w.grpcServer.Stop()
		}
		if w.httpServer != nil {
			if shutdownErr := w.httpServer.Shutdown(ctx); shutdownErr != nil && err == nil {
				err = shutdownErr
			}
		}
		if whatsApp != nil {
			if closeErr := whatsApp.Close(ctx); closeErr != nil && err == nil {
				err = closeErr
			}
		}
		if w.kafka != nil {
			if closeErr := w.kafka.Close(); closeErr != nil && err == nil {
				err = closeErr
			}
		}
		if w.workerCommands != nil {
			w.workerCommands.Close()
		}
		if w.redis != nil {
			if closeErr := w.redis.Close(); closeErr != nil && err == nil {
				err = closeErr
			}
		}
		if w.postgres != nil {
			if closeErr := w.postgres.Close(ctx); closeErr != nil && err == nil {
				err = closeErr
			}
		}
	})
	return err
}

func (w *Worker) startHTTP() error {
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/health/check", func(resp http.ResponseWriter, req *http.Request) {
		statusCode, health := workerProcessLiveness(
			w.currentWhatsApp(),
			time.Now(),
		)
		writeJSON(resp, statusCode, health)
	})
	mux.HandleFunc("/v1/connection/health/check", func(resp http.ResponseWriter, req *http.Request) {
		manager, qrStreamReady := w.currentWhatsAppRuntimeSnapshot()
		standby := w.cfg.WarmStandby && !qrStreamReady
		activated := qrStreamReady
		runtimeState := "inactive"
		if standby {
			runtimeState = "warm_standby"
		} else if activated {
			runtimeState = "active"
		} else if manager != nil {
			runtimeState = "activating"
		}
		health := map[string]any{
			"ready":                               false,
			"connected":                           false,
			"has_session":                         false,
			"qr_stream_ready":                     qrStreamReady,
			"session_ready":                       false,
			"can_send":                            false,
			"can_receive_runtime":                 false,
			"authenticated":                       false,
			"provider":                            "whatsmeow",
			"session_storage":                     w.cfg.SessionStorage,
			"provider_state":                      "not_initialized",
			"degraded_reason":                     "runtime_not_initialized",
			"error":                               "runtime_not_initialized",
			"native_connection_online":            false,
			"connection_status_source_current":    false,
			"connection_status_lease_required":    w.cfg.SessionStorage == SessionStoragePostgres,
			"connection_status_lease_proof_valid": w.cfg.SessionStorage != SessionStoragePostgres,
		}
		if manager != nil {
			health = manager.ConnectionHealth()
		}
		applyPairingRuntimeHealth(health, manager != nil, qrStreamReady)
		health["worker_id"] = w.cfg.WorkerID
		health["account_id"] = w.cfg.AccountID
		health["worker_type_id"] = WorkerTypeWhatsmeow
		health["runtime_state"] = runtimeState
		health["activated"] = activated
		health["standby"] = standby
		kafkaConsumersReady := w.kafkaConsumersReady.Load()
		kafkaConsumersAuthorized := w.kafkaConsumersAuthorized.Load()
		runtimeGenerationReady := w.cfg.RuntimeGeneration > 0
		applyKafkaDispatchReadiness(
			health,
			kafkaConsumersReady,
			kafkaConsumersAuthorized,
		)
		health["kafka_consumers_ready"] = kafkaConsumersReady
		health["kafka_consumers_authorized"] = kafkaConsumersAuthorized
		health["command_ingress_ready"] = kafkaConsumersReady
		health["command_ingress_authorized"] = kafkaConsumersAuthorized
		health["runtime_health_schema_version"] = uint32(3)
		health["central_online_acknowledged"] = kafkaConsumersAuthorized
		health["runtime_generation"] = w.cfg.RuntimeGeneration
		health["runtime_generation_ready"] = runtimeGenerationReady
		connectionReady := healthBool(health, "session_ready") && runtimeGenerationReady
		health["ready"] = connectionReady
		health["connected"] = connectionReady
		health["session_ready"] = connectionReady
		health["can_send"] = healthBool(health, "can_send") && connectionReady
		health["can_receive_runtime"] = healthBool(health, "can_receive_runtime") && connectionReady
		commandIngressConsumers := w.commandIngressHealthSnapshot()
		commandIngressSummary := w.commandIngressHealthSummary()
		health["command_ingress_consumers"] = commandIngressConsumers
		health["command_ingress_summary"] = commandIngressSummary
		// Deprecated response aliases retained until all health readers use the
		// transport-neutral fields above. They contain JetStream state, not Kafka.
		health["kafka_consumers"] = commandIngressConsumers
		health["kafka_consumer_summary"] = commandIngressSummary
		health["plan_entitlement_telemetry"] = w.integrationEntitlementTelemetrySnapshot()
		kafkaUnhealthy := w.commandIngressUnhealthy()
		health["kafka_unhealthy"] = kafkaUnhealthy
		health["command_ingress_unhealthy"] = kafkaUnhealthy
		failOnKafkaUnhealthy := w.cfg.ConnectionHealthFailOnKafkaUnhealthy
		localConnectionStatusLog("whatsmeow.http.connection_health", map[string]any{
			"layer":                               "worker_whatsmeow.http",
			"provider":                            "whatsmeow",
			"worker_id":                           w.cfg.WorkerID,
			"account_id":                          w.cfg.AccountID,
			"worker_type_id":                      WorkerTypeWhatsmeow,
			"has_session":                         healthBool(health, "has_session"),
			"qr_stream_ready":                     healthBool(health, "qr_stream_ready"),
			"session_ready":                       healthBool(health, "session_ready"),
			"can_send":                            healthBool(health, "can_send"),
			"can_receive_runtime":                 healthBool(health, "can_receive_runtime"),
			"authenticated":                       healthBool(health, "authenticated"),
			"provider_state":                      healthString(health, "provider_state"),
			"degraded_reason":                     healthString(health, "degraded_reason"),
			"connected":                           healthBool(health, "connected"),
			"phone":                               healthString(health, "phone"),
			"kafka_unhealthy":                     kafkaUnhealthy,
			"kafka_consumers_ready":               kafkaConsumersReady,
			"kafka_consumers_authorized":          kafkaConsumersAuthorized,
			"command_ingress_ready":               kafkaConsumersReady,
			"command_ingress_authorized":          kafkaConsumersAuthorized,
			"fail_on_kafka_unhealthy":             failOnKafkaUnhealthy,
			"runtime_generation":                  w.cfg.RuntimeGeneration,
			"native_connection_online":            healthBool(health, "native_connection_online"),
			"connection_status_source_current":    healthBool(health, "connection_status_source_current"),
			"connection_status_lease_required":    healthBool(health, "connection_status_lease_required"),
			"connection_status_lease_proof_valid": healthBool(health, "connection_status_lease_proof_valid"),
		})
		if ready, _ := health["session_ready"].(bool); ready && (!kafkaUnhealthy || !failOnKafkaUnhealthy) {
			writeJSON(resp, http.StatusOK, health)
			return
		}
		writeJSON(resp, http.StatusServiceUnavailable, health)
	})
	w.httpServer = &http.Server{
		Addr:              w.cfg.HTTPAddr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}
	go func() {
		if err := w.httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("http server stopped error_code=%s", safeOperationalErrorCode(err))
		}
	}()
	log.Printf("http server listening addr=%s", w.cfg.HTTPAddr)
	return nil
}

func applyPairingRuntimeHealth(
	health map[string]any,
	managerInitialized bool,
	qrStreamReady bool,
) {
	if health == nil {
		return
	}
	health["has_session"] = managerInitialized && healthBool(health, "has_store_id")
	health["qr_stream_ready"] = qrStreamReady
}

func applyKafkaDispatchReadiness(
	health map[string]any,
	consumersReady bool,
	dispatchAuthorized bool,
) {
	if health == nil {
		return
	}
	providerSessionReady := healthBool(health, "session_ready")
	dispatchReady := consumersReady && dispatchAuthorized
	health["session_ready"] = providerSessionReady && dispatchReady
	health["can_send"] = healthBool(health, "can_send") && dispatchReady
	health["can_receive_runtime"] = healthBool(health, "can_receive_runtime") && dispatchReady
	if providerSessionReady {
		switch {
		case !consumersReady:
			health["degraded_reason"] = "command_ingress_positioning"
		case !dispatchAuthorized:
			health["degraded_reason"] = "awaiting_dispatch_authorization"
		}
	}
}

func workerProcessLiveness(
	manager *WhatsAppManager,
	now time.Time,
) (int, map[string]any) {
	if manager != nil && manager.providerStallLivenessFatal(now) {
		return http.StatusServiceUnavailable, map[string]any{
			"status":        "unhealthy",
			"provider":      "whatsmeow",
			"reason":        "context_ignoring_provider_call_quarantined",
			"fatal_runtime": true,
		}
	}
	return http.StatusOK, map[string]any{
		"status":   "ok",
		"provider": "whatsmeow",
	}
}

func (w *Worker) currentWhatsApp() *WhatsAppManager {
	manager, _ := w.currentWhatsAppRuntimeSnapshot()
	return manager
}

func (w *Worker) currentWhatsAppRuntimeSnapshot() (*WhatsAppManager, bool) {
	w.runtimeMu.RLock()
	defer w.runtimeMu.RUnlock()
	return w.whatsapp, w.runtimeStarted
}

func (w *Worker) startActivatedRuntime(ctx context.Context) error {
	w.runtimeMu.Lock()
	defer w.runtimeMu.Unlock()
	return w.startActivatedRuntimeLocked(ctx)
}

func (w *Worker) startActivatedRuntimeLocked(ctx context.Context) error {
	if w.runtimeStarted {
		return nil
	}
	if w.whatsapp == nil {
		return fmt.Errorf("whatsmeow runtime is not initialized")
	}
	w.whatsapp.Bootstrap(ctx)
	if err := w.startConnectionQRCodeRedisStream(ctx); err != nil {
		return err
	}
	w.runtimeStarted = true
	w.startDatabaseAvailabilityGuard(ctx)
	go w.superviseConsumers(ctx)
	go w.runOutboundRecovery(ctx)
	go w.startSelfMonitor(ctx)
	return nil
}

func (w *Worker) startRuntimeActivationAttemptLocked(
	attempt *workerRuntimeActivationAttempt,
	nextCfg Config,
	storage *StorageClient,
	whatsApp *WhatsAppManager,
	workerCommands *WorkerCommandNATSClient,
) error {
	if attempt == nil || attempt.ctx == nil || attempt.cancel == nil {
		return errors.New("runtime activation attempt is not initialized")
	}
	if whatsApp == nil {
		_ = attempt.cleanup(nil)
		return errors.New("whatsmeow runtime is not initialized")
	}
	if workerCommands == nil {
		_ = attempt.cleanup(whatsApp)
		return errors.New("mandatory scoped JetStream command ingress is unavailable")
	}

	previousCfg := w.cfg
	previousStorage := w.storage
	previousWhatsApp := w.whatsapp
	previousWorkerCommands := w.workerCommands
	previousRuntimeCancel := w.runtimeCancel
	previousRuntimeStarted := w.runtimeStarted

	w.cfg = nextCfg
	w.storage = storage
	w.whatsapp = whatsApp
	w.workerCommands = workerCommands
	w.runtimeCancel = nil
	if err := w.startActivatedRuntimeLocked(attempt.ctx); err != nil {
		cleanupErr := attempt.cleanup(whatsApp)
		w.cfg = previousCfg
		w.storage = previousStorage
		w.whatsapp = previousWhatsApp
		w.workerCommands = previousWorkerCommands
		w.runtimeCancel = previousRuntimeCancel
		w.runtimeStarted = previousRuntimeStarted
		w.kafkaConsumersReady.Store(false)
		w.revokeKafkaConsumerAuthorization()
		if cleanupErr != nil {
			return errors.Join(
				err,
				fmt.Errorf("cleanup failed runtime activation: %w", cleanupErr),
			)
		}
		return err
	}

	w.runtimeCancel = attempt.cancel
	return nil
}

func (w *Worker) RequestConnection(ctx context.Context, req StatusConnectionRequest) (ConnectionState, error) {
	if w.databaseSuspended.Load() {
		return ConnectionState{}, errors.New("whatsmeow runtime is suspended while the worker database is unavailable")
	}
	manager := w.currentWhatsApp()
	if manager == nil {
		return ConnectionState{}, fmt.Errorf("whatsmeow runtime is not initialized")
	}
	state, err := manager.RequestConnection(ctx, req)
	manager.attachNativeConnectionStatus(&state)
	return state, err
}

func (w *Worker) SendPasskeyResponse(ctx context.Context, req PasskeyResponseRequest) (ConnectionState, error) {
	if w.databaseSuspended.Load() {
		return ConnectionState{}, errors.New("whatsmeow runtime is suspended while the worker database is unavailable")
	}
	manager := w.currentWhatsApp()
	if manager == nil {
		return ConnectionState{}, fmt.Errorf("whatsmeow runtime is not initialized")
	}
	state, err := manager.SendPasskeyResponse(ctx, req)
	manager.attachNativeConnectionStatus(&state)
	return state, err
}

func (w *Worker) ConfirmPasskey(ctx context.Context, req PasskeyConfirmationRequest) (ConnectionState, error) {
	if w.databaseSuspended.Load() {
		return ConnectionState{}, errors.New("whatsmeow runtime is suspended while the worker database is unavailable")
	}
	manager := w.currentWhatsApp()
	if manager == nil {
		return ConnectionState{}, fmt.Errorf("whatsmeow runtime is not initialized")
	}
	state, err := manager.ConfirmPasskey(ctx, req)
	manager.attachNativeConnectionStatus(&state)
	return state, err
}

func (w *Worker) ImportSecureSession(ctx context.Context, req SecureSessionImportRequest) (ConnectionState, error) {
	if w.databaseSuspended.Load() {
		return ConnectionState{}, errors.New("whatsmeow runtime is suspended while the worker database is unavailable")
	}
	w.runtimeMu.Lock()
	manager := w.whatsapp
	if req.RuntimeGeneration > 0 && w.cfg.RuntimeGeneration != req.RuntimeGeneration {
		w.cfg.RuntimeGeneration = req.RuntimeGeneration
	}
	w.runtimeMu.Unlock()

	if manager == nil {
		return ConnectionState{}, fmt.Errorf("whatsmeow runtime is not initialized")
	}
	state, err := manager.ImportSecureSession(ctx, req)
	manager.attachNativeConnectionStatus(&state)
	return state, err
}

func (w *Worker) ValidatePhone(ctx context.Context, req PhoneValidationRequest) (PhoneValidationResponse, error) {
	if w.databaseSuspended.Load() {
		return PhoneValidationResponse{}, errors.New("whatsmeow runtime is suspended while the worker database is unavailable")
	}
	manager := w.currentWhatsApp()
	if manager == nil {
		return PhoneValidationResponse{}, fmt.Errorf("whatsmeow runtime is not initialized")
	}
	return manager.ValidatePhone(ctx, req)
}

func (w *Worker) ActivateRuntime(ctx context.Context, req WorkerRuntimeActivationRequest) (WorkerRuntimeActivationResponse, error) {
	if req.WorkerID == "" || req.AccountID == "" {
		return WorkerRuntimeActivationResponse{
			Activated:  false,
			WorkerID:   req.WorkerID,
			AccountID:  req.AccountID,
			WarmPoolID: req.WarmPoolID,
			Error:      "worker_id and account_id are required",
		}, fmt.Errorf("worker_id and account_id are required")
	}
	w.runtimeMu.Lock()
	defer w.runtimeMu.Unlock()

	if w.runtimeStarted {
		if w.cfg.WorkerID == req.WorkerID && w.cfg.AccountID == req.AccountID &&
			w.cfg.RuntimeGeneration == req.RuntimeGeneration &&
			w.cfg.RuntimeCapability == strings.TrimSpace(req.RuntimeCapability) &&
			w.cfg.WriterEpoch == strings.TrimSpace(req.WriterEpoch) {
			return WorkerRuntimeActivationResponse{
				Activated:     true,
				AlreadyActive: true,
				WorkerID:      w.cfg.WorkerID,
				AccountID:     w.cfg.AccountID,
				WarmPoolID:    firstNonEmpty(req.WarmPoolID, w.cfg.WarmPoolID),
			}, nil
		}
		err := fmt.Errorf("runtime already activated for worker_id=%s", w.cfg.WorkerID)
		return WorkerRuntimeActivationResponse{
			Activated:  false,
			WorkerID:   req.WorkerID,
			AccountID:  req.AccountID,
			WarmPoolID: req.WarmPoolID,
			Error:      safeOperationalErrorCode(err),
		}, err
	}
	if w.cfg.WarmStandby && (normalizeSessionStorage(req.SessionStorage) != SessionStoragePostgres ||
		strings.TrimSpace(req.WarmPoolID) == "" ||
		strings.TrimSpace(req.WarmPoolID) != strings.TrimSpace(w.cfg.WarmPoolID) ||
		strings.TrimSpace(req.RuntimeCapability) != strings.TrimSpace(w.cfg.RuntimeCapability) ||
		strings.TrimSpace(req.WriterEpoch) != strings.TrimSpace(w.cfg.WriterEpoch)) {
		return WorkerRuntimeActivationResponse{
			Activated:  false,
			WorkerID:   req.WorkerID,
			AccountID:  req.AccountID,
			WarmPoolID: req.WarmPoolID,
			Error:      "postgres warm runtime activation identity is invalid",
		}, errors.New("postgres warm runtime activation identity is invalid")
	}

	nextCfg := w.cfg
	nextCfg.WorkerID = req.WorkerID
	nextCfg.AccountID = req.AccountID
	nextCfg.RuntimeGeneration = req.RuntimeGeneration
	nextCfg.SessionStorage = normalizeSessionStorage(req.SessionStorage)
	nextCfg.RuntimeCapability = strings.TrimSpace(req.RuntimeCapability)
	nextCfg.WriterEpoch = strings.TrimSpace(req.WriterEpoch)
	nextCfg.WarmStandby = false
	if req.WarmPoolID != "" {
		nextCfg.WarmPoolID = req.WarmPoolID
	}
	if nextCfg.WorkerDatabaseURL == "" {
		return WorkerRuntimeActivationResponse{
			Activated:  false,
			WorkerID:   req.WorkerID,
			AccountID:  req.AccountID,
			WarmPoolID: req.WarmPoolID,
			Error:      "worker database URL is required for runtime fence and status outbox",
		}, errors.New("worker database URL is required for runtime fence and status outbox")
	}
	if nextCfg.WorkerDatabaseURL != "" {
		if len(nextCfg.RuntimeCapability) < 32 || nextCfg.RuntimeGeneration <= 0 {
			return WorkerRuntimeActivationResponse{
				Activated:  false,
				WorkerID:   req.WorkerID,
				AccountID:  req.AccountID,
				WarmPoolID: req.WarmPoolID,
				Error:      "direct database runtime identity is incomplete",
			}, errors.New("direct database runtime identity is incomplete")
		}
		if _, err := uuid.Parse(nextCfg.WorkerID); err != nil {
			return WorkerRuntimeActivationResponse{}, errors.New("worker ID must be a UUID for direct database access")
		}
		if _, err := uuid.Parse(nextCfg.AccountID); err != nil {
			return WorkerRuntimeActivationResponse{}, errors.New("account ID must be a UUID for direct database access")
		}
		if _, err := uuid.Parse(nextCfg.WriterEpoch); err != nil {
			return WorkerRuntimeActivationResponse{}, errors.New("writer epoch must be a UUID for direct database access")
		}
	}
	nextCfg, err := workerRuntimeNATSConfig(nextCfg)
	if err != nil {
		return WorkerRuntimeActivationResponse{
			Activated:  false,
			WorkerID:   req.WorkerID,
			AccountID:  req.AccountID,
			WarmPoolID: req.WarmPoolID,
			Error:      safeOperationalErrorCode(err),
		}, err
	}
	workerCommands, err := NewWorkerCommandNATSClient(ctx, nextCfg)
	if err != nil {
		return WorkerRuntimeActivationResponse{
			Activated:  false,
			WorkerID:   req.WorkerID,
			AccountID:  req.AccountID,
			WarmPoolID: req.WarmPoolID,
			Error:      safeOperationalErrorCode(err),
		}, fmt.Errorf("initialize mandatory scoped JetStream command ingress: %w", err)
	}
	// The NATS client owns an isolated in-memory credential copy for reconnects;
	// do not retain another copy in the active worker configuration.
	nextCfg = withoutNATSAuthentication(nextCfg)
	workerCommandsAttached := false
	defer func() {
		if !workerCommandsAttached {
			workerCommands.Close()
		}
	}()

	nextCfg, activationRequest, err := resolveWhatsmeowRuntimeFenceBootstrap(ctx, w.postgres, nextCfg)
	if err != nil {
		return WorkerRuntimeActivationResponse{
			Activated:  false,
			WorkerID:   req.WorkerID,
			AccountID:  req.AccountID,
			WarmPoolID: req.WarmPoolID,
			Error:      safeOperationalErrorCode(err),
		}, err
	}
	nextCfg, err = activateWhatsmeowBootstrapRuntimeFence(
		ctx,
		w.postgres,
		nextCfg,
		activationRequest,
	)
	if err != nil {
		return WorkerRuntimeActivationResponse{
			Activated:  false,
			WorkerID:   req.WorkerID,
			AccountID:  req.AccountID,
			WarmPoolID: req.WarmPoolID,
			Error:      safeOperationalErrorCode(err),
		}, err
	}

	storage, err := NewStorageClient(nextCfg, w.postgres)
	if err != nil {
		return WorkerRuntimeActivationResponse{
			Activated:  false,
			WorkerID:   req.WorkerID,
			AccountID:  req.AccountID,
			WarmPoolID: req.WarmPoolID,
			Error:      safeOperationalErrorCode(err),
		}, err
	}
	attempt := newWorkerRuntimeActivationAttempt(w.runCtx)
	whatsApp, err := NewWhatsAppManager(attempt.ctx, nextCfg, w.kafka, w.centrifugo, storage, w.redis, w.postgres, w.debug)
	if err != nil {
		_ = attempt.cleanup(nil)
		return WorkerRuntimeActivationResponse{
			Activated:  false,
			WorkerID:   req.WorkerID,
			AccountID:  req.AccountID,
			WarmPoolID: req.WarmPoolID,
			Error:      safeOperationalErrorCode(err),
		}, err
	}
	w.kafkaConsumersReady.Store(false)
	w.revokeKafkaConsumerAuthorization()
	whatsApp.setConsumerBarrierCallbacks(func() bool {
		return w.kafkaConsumersReady.Load()
	}, func() {
		w.invalidateKafkaConsumerBarrier()
	})

	if err := w.startRuntimeActivationAttemptLocked(attempt, nextCfg, storage, whatsApp, workerCommands); err != nil {
		return WorkerRuntimeActivationResponse{
			Activated:  false,
			WorkerID:   req.WorkerID,
			AccountID:  req.AccountID,
			WarmPoolID: req.WarmPoolID,
			Error:      safeOperationalErrorCode(err),
		}, err
	}
	workerCommandsAttached = true

	log.Printf("worker runtime activated worker_id=%s account_id=%s warm_pool_id=%s", req.WorkerID, req.AccountID, req.WarmPoolID)
	return WorkerRuntimeActivationResponse{
		Activated:  true,
		WorkerID:   req.WorkerID,
		AccountID:  req.AccountID,
		WarmPoolID: req.WarmPoolID,
	}, nil
}

func (w *Worker) RuntimeHealth(ctx context.Context, req WorkerRuntimeHealthRequest) (WorkerRuntimeHealthResponse, error) {
	w.runtimeMu.RLock()
	defer w.runtimeMu.RUnlock()
	standby := w.cfg.WarmStandby && !w.runtimeStarted
	qrStreamReady := w.runtimeStarted
	// A warm standby intentionally has no provider session manager until
	// ActivateRuntime assigns a channel. Reaching this gRPC handler means the
	// process bootstrap and activation endpoint are already available, so its
	// readiness is independent from WhatsApp, QR and command ingress readiness.
	// Active runtimes remain fail-closed until their provider runtime exists.
	ready := standby || (w.whatsapp != nil && qrStreamReady)
	runtimeState := "inactive"
	if standby {
		runtimeState = "warm_standby"
	} else if w.runtimeStarted {
		runtimeState = "active"
	} else if w.whatsapp != nil {
		runtimeState = "activating"
	}
	hasSession := false
	hasQR := false
	sessionReady := false
	canSend := false
	canReceiveRuntime := false
	authenticated := false
	providerState := ""
	degradedReason := ""
	lastProbeAt := ""
	probeLatencyMS := 0
	phone := ""
	var connectionStatus *WhatsappConnectionStatus
	connectionStatusSourceID := ""
	var sessionRevisionID int64
	kafkaUnhealthy := w.commandIngressUnhealthy()
	kafkaConsumersReady := w.kafkaConsumersReady.Load()
	kafkaConsumersAuthorized := w.kafkaConsumersAuthorized.Load()
	if w.whatsapp != nil {
		health := w.whatsapp.ConnectionHealth()
		if value, ok := health["has_store_id"].(bool); ok {
			hasSession = value
		}
		// RuntimeHealth is also the central ONLINE authorization handshake. It
		// must expose provider + assignment readiness before dispatch is
		// authorized, otherwise Balance cannot ACK the state that opens dispatch.
		// External HTTP health and the self-monitor remain fail-closed below the
		// authorization gate.
		sessionReady = healthBool(health, "session_ready") && kafkaConsumersReady
		canSend = healthBool(health, "can_send") && kafkaConsumersReady
		canReceiveRuntime = healthBool(health, "can_receive_runtime") && kafkaConsumersReady
		authenticated = healthBool(health, "authenticated")
		providerState = healthString(health, "provider_state")
		degradedReason = healthString(health, "degraded_reason")
		lastProbeAt = healthString(health, "last_probe_at")
		probeLatencyMS = healthInt(health, "probe_latency_ms")
		phone = healthString(health, "phone")
		connectionStatus, _ = health["connection_status"].(*WhatsappConnectionStatus)
		connectionStatusSourceID = healthString(health, "connection_status_source_id")
		if phone == "" {
			w.whatsapp.mu.RLock()
			if w.whatsapp.client != nil && w.whatsapp.client.Store.ID != nil {
				phone = phoneFromOwnID(w.whatsapp.client.Store.ID)
			}
			w.whatsapp.mu.RUnlock()
		}
		w.whatsapp.mu.RLock()
		if w.whatsapp.client != nil && w.whatsapp.client.Store != nil && w.whatsapp.client.Store.RevisionID > 0 {
			sessionRevisionID = w.whatsapp.client.Store.RevisionID
		}
		w.whatsapp.mu.RUnlock()
		w.whatsapp.mu.RLock()
		hasQR = w.whatsapp.currentQRCode != ""
		w.whatsapp.mu.RUnlock()
	}
	// ConnectionHealth may synchronously revoke authorization when the native
	// ONLINE/source/lease proof disappears. Never return the value captured
	// before that fail-closed revalidation.
	kafkaConsumersAuthorized = w.kafkaConsumersAuthorized.Load()
	if sessionReady && kafkaConsumersReady && !kafkaConsumersAuthorized {
		degradedReason = "awaiting_dispatch_authorization"
	}
	response := WorkerRuntimeHealthResponse{
		Ready:                      ready,
		Standby:                    standby,
		Activated:                  w.runtimeStarted,
		WorkerID:                   w.cfg.WorkerID,
		AccountID:                  w.cfg.AccountID,
		WarmPoolID:                 firstNonEmpty(req.WarmPoolID, w.cfg.WarmPoolID),
		HasSession:                 hasSession,
		HasQR:                      hasQR,
		WorkerTypeID:               WorkerTypeWhatsmeow,
		RuntimeGeneration:          w.cfg.RuntimeGeneration,
		RuntimeState:               runtimeState,
		QRStreamReady:              qrStreamReady,
		SessionReady:               sessionReady,
		CanSend:                    canSend,
		CanReceiveRuntime:          canReceiveRuntime,
		Authenticated:              authenticated,
		ProviderState:              providerState,
		DegradedReason:             degradedReason,
		LastProbeAt:                lastProbeAt,
		ProbeLatencyMS:             probeLatencyMS,
		Phone:                      phone,
		KafkaUnhealthy:             kafkaUnhealthy,
		KafkaConsumersReady:        kafkaConsumersReady,
		KafkaConsumersAuthorized:   kafkaConsumersAuthorized,
		CommandIngressReady:        kafkaConsumersReady,
		CommandIngressAuthorized:   kafkaConsumersAuthorized,
		RuntimeHealthSchemaVersion: 4,
		ConnectionStatus:           connectionStatus,
		ConnectionStatusSourceID:   connectionStatusSourceID,
		SessionStorage:             w.cfg.SessionStorage,
		SessionRevisionID:          sessionRevisionID,
		SessionStorageMigrationID:  w.cfg.SessionStorageMigrationID,
	}
	localConnectionStatusLog("whatsmeow.grpc.runtime_health", map[string]any{
		"layer":                      "worker_whatsmeow.grpc",
		"provider":                   "whatsmeow",
		"worker_id":                  response.WorkerID,
		"account_id":                 response.AccountID,
		"worker_type_id":             response.WorkerTypeID,
		"session_ready":              response.SessionReady,
		"can_send":                   response.CanSend,
		"can_receive_runtime":        response.CanReceiveRuntime,
		"authenticated":              response.Authenticated,
		"provider_state":             response.ProviderState,
		"degraded_reason":            response.DegradedReason,
		"runtime_generation":         response.RuntimeGeneration,
		"runtime_state":              response.RuntimeState,
		"ready":                      response.Ready,
		"activated":                  response.Activated,
		"standby":                    response.Standby,
		"has_session":                response.HasSession,
		"has_qr":                     response.HasQR,
		"qr_stream_ready":            response.QRStreamReady,
		"phone":                      response.Phone,
		"kafka_unhealthy":            response.KafkaUnhealthy,
		"kafka_consumers_ready":      response.KafkaConsumersReady,
		"kafka_consumers_authorized": kafkaConsumersAuthorized,
		"command_ingress_ready":      response.CommandIngressReady,
		"command_ingress_authorized": response.CommandIngressAuthorized,
		"request_worker_id":          req.WorkerID,
		"request_warm_pool_id":       req.WarmPoolID,
	})
	return response, nil
}

func writeJSON(resp http.ResponseWriter, status int, payload any) {
	resp.Header().Set("Content-Type", "application/json")
	resp.WriteHeader(status)
	_ = json.NewEncoder(resp).Encode(payload)
}

func (w *Worker) invalidateKafkaConsumerBarrier() {
	w.revokeKafkaConsumerAuthorization()
	wasReady := w.kafkaConsumersReady.Swap(false)
	if !wasReady && !w.kafkaConsumersStarted.Load() {
		return
	}
	if w.kafkaConsumerRestart == nil {
		return
	}
	select {
	case w.kafkaConsumerRestart <- struct{}{}:
	default:
	}
}

func (w *Worker) resetKafkaConsumerRepairBudget() {
	w.kafkaConsumerRepairMu.Lock()
	w.kafkaConsumerRepairAttempts = 0
	w.kafkaConsumerLastRepairAt = time.Time{}
	w.kafkaConsumerRepairMu.Unlock()
}

func (w *Worker) tryLocalKafkaConsumerRepair(now time.Time) (handled bool, scheduled bool, attempt int) {
	if now.IsZero() {
		now = time.Now()
	}
	cooldown := w.cfg.KafkaConsumerRepairCooldown
	if cooldown <= 0 {
		cooldown = 30 * time.Second
	}
	maxRepairs := w.cfg.KafkaConsumerMaxLocalRepairs
	if maxRepairs <= 0 {
		maxRepairs = 3
	}

	w.kafkaConsumerRepairMu.Lock()
	if !w.kafkaConsumerLastRepairAt.IsZero() &&
		now.Sub(w.kafkaConsumerLastRepairAt) < cooldown {
		attempt = w.kafkaConsumerRepairAttempts
		w.kafkaConsumerRepairMu.Unlock()
		return true, false, attempt
	}
	if w.kafkaConsumerRepairAttempts >= maxRepairs {
		attempt = w.kafkaConsumerRepairAttempts
		w.kafkaConsumerRepairMu.Unlock()
		return false, false, attempt
	}
	w.kafkaConsumerRepairAttempts++
	w.kafkaConsumerLastRepairAt = now
	attempt = w.kafkaConsumerRepairAttempts
	w.kafkaConsumerRepairMu.Unlock()

	w.revokeKafkaConsumerAuthorization()
	w.kafkaConsumersReady.Store(false)
	if w.kafkaConsumerRestart == nil {
		return false, false, attempt
	}
	select {
	case w.kafkaConsumerRestart <- struct{}{}:
		return true, true, attempt
	default:
		// A repair is already queued. Treat this request as coalesced so the
		// self-monitor does not escalate into a full provider recreation while
		// the local Kafka generation is being replaced.
		return true, false, attempt
	}
}

func (w *Worker) observeKafkaConsumerLifecycle(event KafkaConsumerLifecycleEvent) {
	if event.Ready {
		return
	}
	// This callback runs synchronously in the consumer generation before its
	// lifecycle event is delivered to the supervisor. Fence online/readiness
	// immediately; the supervisor then publishes the visible connecting state.
	w.revokeKafkaConsumerAuthorization()
	w.kafkaConsumersReady.Store(false)
}

func (w *Worker) revokeKafkaConsumerAuthorization() {
	// Close authorization before advancing the epoch. A handler can therefore
	// never capture the replacement epoch while the old generation is still
	// dispatchable, and every already-captured context is invalidated by at
	// least one of the two checks.
	w.kafkaDispatchMu.Lock()
	w.kafkaConsumersAuthorized.Store(false)
	w.kafkaConsumerBarrierEpoch.Add(1)
	w.kafkaDispatchMu.Unlock()
}

type kafkaConsumerSetOwnershipDisposition string

const (
	kafkaConsumerSetActive    kafkaConsumerSetOwnershipDisposition = "active"
	kafkaConsumerSetSuspended kafkaConsumerSetOwnershipDisposition = "suspended"
	kafkaConsumerSetStopped   kafkaConsumerSetOwnershipDisposition = "stopped"
)

func evaluateKafkaConsumerSetOwnership(
	managerMatches bool,
	providerReady bool,
	localScope whatsAppRuntimeFence,
	localScopeAvailable bool,
	expectedScope whatsAppRuntimeFence,
	activeScope whatsAppRuntimeFence,
	activeScopeErr error,
) (kafkaConsumerSetOwnershipDisposition, string) {
	if !managerMatches {
		return kafkaConsumerSetStopped, "provider_manager_replaced"
	}
	if !localScopeAvailable || localScope != expectedScope {
		return kafkaConsumerSetStopped, "local_runtime_fence_replaced"
	}
	if !providerReady {
		return kafkaConsumerSetSuspended, "provider_not_ready"
	}
	if activeScopeErr != nil {
		if errors.Is(activeScopeErr, errWhatsAppRuntimeFenceRevoked) ||
			errors.Is(activeScopeErr, errOutboundProviderCallStalled) {
			return kafkaConsumerSetStopped, "runtime_fence_revoked"
		}
		return kafkaConsumerSetSuspended, "runtime_fence_temporarily_unavailable"
	}
	if activeScope != expectedScope {
		return kafkaConsumerSetStopped, "runtime_fence_replaced"
	}
	return kafkaConsumerSetActive, ""
}

func (w *Worker) superviseConsumers(ctx context.Context) {
	ticker := time.NewTicker(whatsmeowSessionReadyPollInterval)
	defer ticker.Stop()

	var consumerCancel context.CancelFunc
	var consumerHandles []KafkaConsumerHandle
	var consumerBarrier *kafkaConsumerSetBarrier
	var consumerManager *WhatsAppManager
	var consumerScope whatsAppRuntimeFence
	var readiness <-chan bool
	var onlineAuthorizationRetryAt time.Time
	var consumerSuspendedReason string
	onlineAuthorizationFailures := 0
	resetOnlineAuthorizationRetry := func() {
		onlineAuthorizationRetryAt = time.Time{}
		onlineAuthorizationFailures = 0
	}
	scheduleOnlineAuthorizationRetry := func() {
		onlineAuthorizationFailures++
		delay := consumerOnlineAuthorizationRetryBackoff(onlineAuthorizationFailures)
		onlineAuthorizationRetryAt = time.Now().Add(delay)
		log.Printf(
			"whatsmeow central online authorization retry scheduled worker_id=%s attempt=%d delay=%s active_consumers=%d expected_consumers=%d",
			w.cfg.WorkerID,
			onlineAuthorizationFailures,
			delay,
			len(consumerHandles),
			len(consumerBarrier.states),
		)
	}
	stopConsumers := func(reason string) {
		resetOnlineAuthorizationRetry()
		consumerSuspendedReason = ""
		if consumerCancel == nil {
			w.revokeKafkaConsumerAuthorization()
			w.kafkaConsumersReady.Store(false)
			w.kafkaConsumersStarted.Store(false)
			consumerManager = nil
			consumerScope = whatsAppRuntimeFence{}
			return
		}
		w.revokeKafkaConsumerAuthorization()
		w.kafkaConsumersReady.Store(false)
		w.kafkaConsumersStarted.Store(false)
		consumerCancel()
		for _, handle := range consumerHandles {
			select {
			case <-handle.Done:
			case <-ctx.Done():
			}
		}
		consumerCancel = nil
		consumerHandles = nil
		consumerBarrier = nil
		consumerManager = nil
		consumerScope = whatsAppRuntimeFence{}
		readiness = nil
		log.Printf("whatsmeow command ingress stopped worker_id=%s reason=%s", w.cfg.WorkerID, reason)
	}
	suspendConsumers := func(reason string) {
		if consumerCancel == nil {
			return
		}
		if consumerSuspendedReason == reason &&
			!w.kafkaConsumersAuthorized.Load() &&
			!w.kafkaConsumersReady.Load() {
			return
		}
		w.revokeKafkaConsumerAuthorization()
		w.kafkaConsumersReady.Store(false)
		resetOnlineAuthorizationRetry()
		onlineAuthorizationRetryAt = time.Now()
		consumerSuspendedReason = reason
		log.Printf(
			"whatsmeow command ingress suspended in place worker_id=%s reason=%s active_consumers=%d expected_consumers=%d",
			w.cfg.WorkerID,
			reason,
			len(consumerHandles),
			len(consumerBarrier.states),
		)
	}
	attemptOnlineAuthorization := func(reason string) (retry bool, stopReason string) {
		manager := w.currentWhatsApp()
		if consumerCancel == nil ||
			consumerBarrier == nil ||
			manager == nil ||
			manager != consumerManager {
			return false, "provider_or_runtime_fence_not_ready"
		}
		if !consumerBarrier.isReady() ||
			!healthBool(manager.ConnectionHealth(), "session_ready") {
			return true, ""
		}
		currentScope, scopeErr := manager.captureActiveConnectionScope(ctx)
		if scopeErr != nil {
			if errors.Is(scopeErr, errWhatsAppRuntimeFenceRevoked) ||
				errors.Is(scopeErr, errOutboundProviderCallStalled) {
				return false, "runtime_fence_revoked_before_online"
			}
			return true, ""
		}
		if currentScope != consumerScope {
			return false, "runtime_fence_replaced_before_online"
		}

		// Keep the JetStream command assignment alive, but close dispatch until
		// Balance has durably acknowledged this exact runtime generation as ONLINE.
		w.revokeKafkaConsumerAuthorization()
		w.kafkaConsumersReady.Store(true)
		consumerEpoch := w.kafkaConsumerBarrierEpoch.Load()
		currentScope, scopeErr = manager.captureActiveConnectionScope(ctx)
		if !consumerBarrier.isReady() || scopeErr != nil || currentScope != consumerScope {
			w.kafkaConsumersReady.Store(false)
			if scopeErr != nil &&
				!errors.Is(scopeErr, errWhatsAppRuntimeFenceRevoked) &&
				!errors.Is(scopeErr, errOutboundProviderCallStalled) {
				return true, ""
			}
			if scopeErr == nil && currentScope == consumerScope {
				return true, ""
			}
			return false, "runtime_fence_revoked_before_online"
		}

		if !manager.publishConnectedAfterConsumerBarrierForScope(ctx, consumerScope, reason) {
			w.revokeKafkaConsumerAuthorization()
			currentScope, scopeErr = manager.captureActiveConnectionScope(ctx)
			if consumerBarrier.isReady() &&
				healthBool(manager.ConnectionHealth(), "session_ready") &&
				scopeErr == nil &&
				currentScope == consumerScope {
				// A transient notify_worker_status failure is recoverable in
				// place. The durable stays assigned and no handler can dispatch
				// until a later central ACK succeeds.
				w.kafkaConsumersReady.Store(true)
				return true, ""
			}
			if scopeErr != nil &&
				!errors.Is(scopeErr, errWhatsAppRuntimeFenceRevoked) &&
				!errors.Is(scopeErr, errOutboundProviderCallStalled) {
				w.kafkaConsumersReady.Store(false)
				return true, ""
			}
			w.kafkaConsumersReady.Store(false)
			return false, "runtime_fence_revoked_during_online"
		}

		currentScope, scopeErr = manager.captureActiveConnectionScope(ctx)
		if consumerEpoch != w.kafkaConsumerBarrierEpoch.Load() ||
			!consumerBarrier.isReady() ||
			scopeErr != nil ||
			currentScope != consumerScope {
			w.kafkaConsumersReady.Store(false)
			w.revokeKafkaConsumerAuthorization()
			manager.publishStatePreservingConsumerBarrier(ctx, "connecting", CodeAwaitConnection, WorkerStatusDisponible, "", "", false)
			if scopeErr != nil &&
				!errors.Is(scopeErr, errWhatsAppRuntimeFenceRevoked) &&
				!errors.Is(scopeErr, errOutboundProviderCallStalled) {
				return true, ""
			}
			if scopeErr == nil && currentScope == consumerScope {
				return true, ""
			}
			return false, "authorization_changed_after_online_publish"
		}
		if !w.authorizeKafkaConsumerDispatchIfCurrent(
			ctx,
			manager,
			consumerScope,
			consumerBarrier,
			consumerEpoch,
		) {
			w.kafkaConsumersReady.Store(false)
			manager.publishStatePreservingConsumerBarrier(ctx, "connecting", CodeAwaitConnection, WorkerStatusDisponible, "", "", false)
			currentScope, scopeErr = manager.captureActiveConnectionScope(ctx)
			if scopeErr != nil &&
				!errors.Is(scopeErr, errWhatsAppRuntimeFenceRevoked) &&
				!errors.Is(scopeErr, errOutboundProviderCallStalled) {
				return true, ""
			}
			if scopeErr == nil && currentScope == consumerScope {
				return true, ""
			}
			return false, "authorization_changed_before_dispatch"
		}

		resetOnlineAuthorizationRetry()
		consumerSuspendedReason = ""
		log.Printf("whatsmeow command ingress active worker_id=%s reason=jetstream_durable_ready", w.cfg.WorkerID)
		return false, ""
	}
	defer stopConsumers("supervisor_stopped")

	for {
		if w.providerHandoffBlocked.Load() {
			stopConsumers("provider_handoff")
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				continue
			}
		}
		manager := w.currentWhatsApp()
		providerReady := manager != nil && healthBool(manager.ConnectionHealth(), "session_ready")
		activeScope, scopeErr := captureKafkaConsumerOwnerScope(ctx, manager, providerReady)
		ownsActiveScope := scopeErr == nil

		if consumerCancel != nil {
			var (
				localScope          whatsAppRuntimeFence
				localScopeAvailable bool
			)
			if manager != nil {
				localScope, localScopeAvailable = manager.currentInboundConnectionScope()
			}
			disposition, reason := evaluateKafkaConsumerSetOwnership(
				manager == consumerManager,
				providerReady,
				localScope,
				localScopeAvailable,
				consumerScope,
				activeScope,
				scopeErr,
			)
			switch disposition {
			case kafkaConsumerSetStopped:
				stopConsumers(reason)
			case kafkaConsumerSetSuspended:
				suspendConsumers(reason)
			case kafkaConsumerSetActive:
				if consumerSuspendedReason != "" {
					consumerSuspendedReason = ""
					onlineAuthorizationRetryAt = time.Now()
				}
			}
		}

		if ownsActiveScope && consumerCancel == nil {
			w.revokeKafkaConsumerAuthorization()
			consumerCtx, cancel := context.WithCancel(ctx)
			w.kafkaConsumersStarted.Store(true)
			handles, lifecycleBarrier, err := w.startConsumers(consumerCtx)
			if err != nil {
				w.kafkaConsumersStarted.Store(false)
				cancel()
				log.Printf("whatsmeow command ingress start failed worker_id=%s error_code=%s", w.cfg.WorkerID, safeOperationalErrorCode(err))
			} else {
				consumerCancel = cancel
				consumerHandles = handles
				consumerBarrier = lifecycleBarrier
				consumerManager = manager
				consumerScope = activeScope
				readiness = lifecycleBarrier.readiness()
				startedScope, startedScopeErr :=
					consumerManager.captureActiveConnectionScope(consumerCtx)
				if startedScopeErr == nil && startedScope == consumerScope {
					log.Printf(
						"whatsmeow command ingress binding durable worker_id=%s generation=%d connection_epoch=%s reason=active_runtime_fence",
						w.cfg.WorkerID,
						consumerScope.RuntimeGeneration,
						consumerScope.ConnectionEpoch,
					)
				} else if startedScopeErr != nil &&
					!errors.Is(startedScopeErr, errWhatsAppRuntimeFenceRevoked) &&
					!errors.Is(startedScopeErr, errOutboundProviderCallStalled) {
					suspendConsumers("runtime_fence_temporarily_unavailable_during_start")
				} else {
					stopConsumers("runtime_fence_revoked_during_start")
				}
			}
		}

		select {
		case <-ctx.Done():
			return
		case <-w.kafkaConsumerRestart:
			stopConsumers("restart_requested")
		case allReady, lifecycleOpen := <-readiness:
			if !lifecycleOpen {
				readiness = nil
				stopConsumers("lifecycle_closed")
				continue
			}
			manager := w.currentWhatsApp()
			if manager != consumerManager {
				stopConsumers("runtime_fence_revoked_before_readiness")
				continue
			}
			readinessScope, readinessScopeErr :=
				consumerManager.captureActiveConnectionScope(ctx)
			if readinessScopeErr != nil {
				if !errors.Is(readinessScopeErr, errWhatsAppRuntimeFenceRevoked) &&
					!errors.Is(readinessScopeErr, errOutboundProviderCallStalled) {
					suspendConsumers("runtime_fence_temporarily_unavailable_before_readiness")
					continue
				}
				stopConsumers("runtime_fence_revoked_before_readiness")
				continue
			}
			if readinessScope != consumerScope {
				stopConsumers("runtime_fence_replaced_before_readiness")
				continue
			}
			if !allReady {
				resetOnlineAuthorizationRetry()
				if !shouldRestartCommandIngressGeneration(
					allReady,
					consumerBarrier,
				) {
					// The false/true transition completed while the supervisor was
					// busy. The queued true event will perform the guarded reopen.
					continue
				}
				w.kafkaConsumersReady.Store(false)
				if manager != nil && healthBool(manager.ConnectionHealth(), "session_ready") {
					manager.publishStatePreservingConsumerBarrier(ctx, "connecting", CodeAwaitConnection, WorkerStatusDisponible, "", "", false)
				}
				// A WorkerCommandNATSClient handle emits Ready=true exactly once
				// and Ready=false only when its pull loop has terminated. Keeping
				// consumerCancel non-nil here prevents the supervisor from ever
				// binding a replacement after a transient NATS disconnect.
				stopConsumers("consumer_generation_terminated")
				continue
			}
			if consumerBarrier == nil || !consumerBarrier.isReady() {
				continue
			}
			retry, stopReason := attemptOnlineAuthorization("jetstream-command-ingress-ready")
			if stopReason != "" {
				stopConsumers(stopReason)
				continue
			}
			if retry {
				scheduleOnlineAuthorizationRetry()
			}
		case <-ticker.C:
			if !shouldReconcileKafkaConsumerOnlineAuthorization(
				time.Now(),
				onlineAuthorizationRetryAt,
				consumerCancel != nil,
				consumerBarrier != nil && consumerBarrier.isReady(),
				w.kafkaConsumersAuthorized.Load(),
			) {
				continue
			}
			retry, stopReason := attemptOnlineAuthorization("central-online-authorization-reconcile")
			if stopReason != "" {
				stopConsumers(stopReason)
				continue
			}
			if retry {
				scheduleOnlineAuthorizationRetry()
			}
		}
	}
}

func shouldRestartCommandIngressGeneration(
	allReady bool,
	barrier *kafkaConsumerSetBarrier,
) bool {
	if allReady {
		return false
	}
	// The atomics are authoritative. If a ready transition raced ahead of a
	// queued false notification, the current generation is already healthy and
	// must not be churned. A persistently false barrier represents a terminal
	// pull generation and must be replaced.
	return barrier == nil || !barrier.isReady()
}

// shouldReconcileKafkaConsumerOnlineAuthorization treats the aggregate
// barrier as authoritative. A false/true lifecycle transition can be
// coalesced while the supervisor is handling the false notification; when
// that happens there may be no retry timestamp even though the command reader
// is positioned again. The periodic reconciliation must therefore attempt
// authorization immediately when no backoff is scheduled. A scheduled retry
// remains bounded by its backoff, and the authorization path still validates
// the exact barrier epoch and runtime fence before opening dispatch.
func shouldReconcileKafkaConsumerOnlineAuthorization(
	now time.Time,
	retryAt time.Time,
	consumersStarted bool,
	barrierReady bool,
	authorized bool,
) bool {
	if !consumersStarted || !barrierReady || authorized {
		return false
	}
	return retryAt.IsZero() || !now.Before(retryAt)
}

func consumerOnlineAuthorizationRetryBackoff(attempt int) time.Duration {
	if attempt <= 1 {
		return consumerOnlineAuthorizationRetryBaseDelay
	}
	delay := consumerOnlineAuthorizationRetryBaseDelay
	for current := 1; current < attempt && delay < consumerOnlineAuthorizationRetryMaximumDelay; current++ {
		delay *= 2
		if delay >= consumerOnlineAuthorizationRetryMaximumDelay {
			return consumerOnlineAuthorizationRetryMaximumDelay
		}
	}
	return delay
}

func (w *Worker) authorizeKafkaConsumerDispatchIfCurrent(
	ctx context.Context,
	manager kafkaConsumerOwnerScopeCapturer,
	scope whatsAppRuntimeFence,
	barrier *kafkaConsumerSetBarrier,
	expectedEpoch uint64,
) bool {
	w.kafkaDispatchMu.Lock()
	defer w.kafkaDispatchMu.Unlock()

	isCurrent := func() bool {
		return expectedEpoch != 0 &&
			expectedEpoch == w.kafkaConsumerBarrierEpoch.Load() &&
			w.kafkaConsumersReady.Load() &&
			barrier != nil &&
			barrier.isReady() &&
			isKafkaConsumerOwnerScopeCurrent(ctx, manager, scope)
	}

	if !isCurrent() {
		w.kafkaConsumersAuthorized.Store(false)
		return false
	}

	// Keep handlers behind kafkaDispatchMu until authorization is visible and
	// the final runtime/barrier validation has completed. No consumer can
	// observe the provisional true state.
	w.kafkaConsumersAuthorized.Store(true)
	if !isCurrent() {
		w.kafkaConsumersAuthorized.Store(false)
		return false
	}
	if w.kafka != nil {
		w.kafka.clearDispatchAuthorizationHolds()
	}
	return true
}

type kafkaConsumerOwnerScopeCapturer interface {
	captureActiveConnectionScope(context.Context) (whatsAppRuntimeFence, error)
}

func captureKafkaConsumerOwnerScope(
	ctx context.Context,
	manager kafkaConsumerOwnerScopeCapturer,
	providerReady bool,
) (whatsAppRuntimeFence, error) {
	if manager == nil || !providerReady {
		return whatsAppRuntimeFence{}, errWhatsAppRuntimeFenceRevoked
	}
	return manager.captureActiveConnectionScope(ctx)
}

func isKafkaConsumerOwnerScopeCurrent(
	ctx context.Context,
	manager kafkaConsumerOwnerScopeCapturer,
	expected whatsAppRuntimeFence,
) bool {
	if manager == nil || !expected.isValid() {
		return false
	}
	active, err := manager.captureActiveConnectionScope(ctx)
	return err == nil && active == expected
}

func waitKafkaConsumerHandlesReady(ctx context.Context, handles []KafkaConsumerHandle) <-chan bool {
	result := make(chan bool, 1)
	go func() {
		for _, handle := range handles {
			select {
			case <-handle.Ready:
			case <-handle.Done:
				result <- false
				return
			case <-ctx.Done():
				result <- false
				return
			}
		}
		result <- true
	}()
	return result
}

type kafkaConsumerSetBarrier struct {
	ctx           context.Context
	states        map[string]*atomic.Bool
	mu            sync.Mutex
	allReady      bool
	updates       chan bool
	onPositioning KafkaConsumerLifecycleObserver
}

func newKafkaConsumerSetBarrier(ctx context.Context, consumerKeys []string, onPositioning KafkaConsumerLifecycleObserver) *kafkaConsumerSetBarrier {
	states := make(map[string]*atomic.Bool, len(consumerKeys))
	for _, key := range consumerKeys {
		states[key] = &atomic.Bool{}
	}
	return &kafkaConsumerSetBarrier{
		ctx:           ctx,
		states:        states,
		updates:       make(chan bool, 1),
		onPositioning: onPositioning,
	}
}

func (b *kafkaConsumerSetBarrier) observe(event KafkaConsumerLifecycleEvent) {
	if b == nil {
		return
	}
	state := b.states[kafkaConsumerHealthKey(event.Topic, event.GroupID)]
	if state == nil {
		return
	}
	// Publish the latest per-consumer state before taking the aggregate lock.
	// A concurrent ready transition therefore cannot reopen the set while this
	// consumer is already known to be positioning.
	state.Store(event.Ready)
	if !event.Ready && b.onPositioning != nil {
		b.onPositioning(event)
	}

	b.mu.Lock()
	defer b.mu.Unlock()
	allReady := len(b.states) > 0
	for _, consumerReady := range b.states {
		if !consumerReady.Load() {
			allReady = false
			break
		}
	}
	if allReady == b.allReady {
		return
	}
	b.allReady = allReady
	select {
	case b.updates <- allReady:
		return
	default:
	}
	// The per-consumer atomics above are authoritative. Coalesce a supervisor
	// notification that has not yet been consumed instead of backpressuring a
	// Kafka generation callback.
	select {
	case <-b.updates:
	default:
	}
	select {
	case b.updates <- allReady:
	case <-b.ctx.Done():
	default:
	}
}

func (b *kafkaConsumerSetBarrier) readiness() <-chan bool {
	if b == nil {
		return nil
	}
	return b.updates
}

func (b *kafkaConsumerSetBarrier) isReady() bool {
	if b == nil || len(b.states) == 0 {
		return false
	}
	for _, consumerReady := range b.states {
		if !consumerReady.Load() {
			return false
		}
	}
	return true
}

func runOnceOnContextDone(ctx context.Context, callback func()) func() {
	if ctx == nil {
		ctx = context.Background()
	}
	if callback == nil {
		callback = func() {}
	}
	var once sync.Once
	run := func() { once.Do(callback) }
	stopAfterFunc := context.AfterFunc(ctx, run)
	return func() {
		stopAfterFunc()
		run()
	}
}

func (w *Worker) waitForKafkaDispatchAdmission(
	ctx context.Context,
) (context.Context, func(), error) {
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		if w.kafkaConsumersAuthorized.Load() && w.kafkaConsumersReady.Load() {
			epoch := w.kafkaConsumerBarrierEpoch.Load()
			if w.kafkaConsumersAuthorized.Load() &&
				w.kafkaConsumersReady.Load() &&
				epoch == w.kafkaConsumerBarrierEpoch.Load() {
				var effectLease *whatsAppRuntimeEffectLease
				if w.runtimeEffectLeasesRequired {
					if w.whatsapp == nil {
						return ctx, func() {}, errWhatsAppRuntimeFenceRevoked
					}
					var err error
					effectLease, err = w.whatsapp.acquireActiveRuntimeEffectLease(ctx)
					if err != nil {
						return ctx, func() {}, err
					}
					if effectLease == nil {
						// A cutover already closed admission. Abandon this Kafka
						// generation without committing so the replacement resumes
						// at the committed offset and redelivers the record.
						return ctx, func() {}, restartKafkaGenerationWithoutCommit(errWhatsAppRuntimeFenceRevoked)
					}
				}
				releaseEffectLease := func() {
					if effectLease == nil {
						return
					}
					releaseCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
					if _, releaseErr := effectLease.release(releaseCtx); releaseErr != nil {
						log.Printf(
							"whatsmeow runtime effect lease release failed worker_id=%s error_code=%s",
							w.cfg.WorkerID,
							safeOperationalErrorCode(releaseErr),
						)
					}
					cancel()
				}
				// Cancellation must not delete a lease while the handler may
				// still be executing. Stop its heartbeat and let the Redis TTL
				// quarantine the old effect; a normally settled handler runs
				// the owner-token release below.
				stopCancellationAbandon := func() bool { return true }
				if effectLease != nil {
					stopCancellationAbandon = context.AfterFunc(ctx, effectLease.abandonHeartbeat)
				}
				var releaseOnce sync.Once
				release := func() {
					releaseOnce.Do(func() {
						stopCancellationAbandon()
						releaseEffectLease()
					})
				}
				authorizedCtx := context.WithValue(ctx, kafkaDispatchAuthorizationContextKey{}, kafkaDispatchAuthorization{
					worker:      w,
					epoch:       epoch,
					effectLease: effectLease,
				})
				if err := w.assertKafkaDispatchAuthorized(authorizedCtx); err != nil {
					release()
					return ctx, func() {}, err
				}
				return authorizedCtx, release, nil
			}
		}
		select {
		case <-ctx.Done():
			return ctx, func() {}, ctx.Err()
		case <-ticker.C:
		}
	}
}

func abandonKafkaDispatchEffectLease(ctx context.Context) time.Duration {
	if ctx == nil {
		return 0
	}
	authorization, ok := ctx.Value(kafkaDispatchAuthorizationContextKey{}).(kafkaDispatchAuthorization)
	if !ok || authorization.effectLease == nil {
		return 0
	}
	authorization.effectLease.abandonHeartbeat()
	return authorization.effectLease.ttl
}

func (w *Worker) authorizedKafkaHandler(handler KafkaMessageHandler) KafkaMessageHandler {
	return func(ctx context.Context, msg kafka.Message) error {
		authorizedCtx, release, err := w.waitForKafkaDispatchAdmission(ctx)
		if err != nil {
			return err
		}
		defer release()
		return handler(authorizedCtx, msg)
	}
}

func initialKafkaConsumerBarrierEpoch() uint64 {
	var seed [8]byte
	if _, err := cryptorand.Read(seed[:]); err == nil {
		// Keep two high bits available so assignment invalidations cannot wrap
		// the counter even after an unrealistically large number of rebalances.
		return binary.BigEndian.Uint64(seed[:])&((uint64(1)<<62)-1) | uint64(1)<<61
	}
	// Keep restart epochs outside the small deterministic values used by unit
	// tests and make a fallback collision across processes extremely unlikely.
	return uint64(time.Now().UnixMilli())<<20 | uint64(time.Now().UnixNano())&((1<<20)-1)
}

func (w *Worker) kafkaDispatchAssignmentEpoch(ctx context.Context) (uint64, error) {
	if ctx == nil {
		return 0, errKafkaConsumerDispatchRevoked
	}
	if err := ctx.Err(); err != nil {
		return 0, errors.Join(errKafkaConsumerDispatchRevoked, err)
	}
	authorization, ok := ctx.Value(kafkaDispatchAuthorizationContextKey{}).(kafkaDispatchAuthorization)
	if !ok || authorization.worker != w {
		return 0, errKafkaConsumerDispatchRevoked
	}
	if !w.kafkaConsumersAuthorized.Load() ||
		!w.kafkaConsumersReady.Load() ||
		authorization.epoch != w.kafkaConsumerBarrierEpoch.Load() {
		return 0, errKafkaConsumerDispatchRevoked
	}
	if w.runtimeEffectLeasesRequired {
		if authorization.effectLease == nil ||
			authorization.effectLease.assertOwned() != nil {
			return 0, errKafkaConsumerDispatchRevoked
		}
	}
	if _, present := ctx.Value(workerCommandEpochContextKey{}).(workerCommandEpochContext); present {
		if err := verifyWorkerCommandEpochFromContext(ctx); err != nil {
			return 0, errors.Join(errKafkaConsumerDispatchRevoked, err)
		}
	}
	return authorization.epoch, nil
}

func (w *Worker) assertKafkaDispatchAuthorized(ctx context.Context) error {
	_, err := w.kafkaDispatchAssignmentEpoch(ctx)
	return err
}

func (w *Worker) assertKafkaAssignmentEpochActive(epoch uint64) error {
	if epoch == 0 ||
		!w.kafkaConsumersAuthorized.Load() ||
		!w.kafkaConsumersReady.Load() ||
		epoch != w.kafkaConsumerBarrierEpoch.Load() {
		return errKafkaConsumerDispatchRevoked
	}
	return nil
}

func (w *Worker) runKafkaRepublishAuthorized(
	ctx context.Context,
	publish func(context.Context) error,
) error {
	if publish == nil {
		return errors.New("Kafka republish callback is required")
	}
	if err := w.assertKafkaDispatchAuthorized(ctx); err != nil {
		return err
	}
	return publish(ctx)
}

func (w *Worker) kafkaAndConnectionAuthorization(
	connectionScope whatsAppRuntimeFence,
) providerAuthorizationGuard {
	return func(ctx context.Context) error {
		if w.whatsapp == nil {
			return errWhatsAppRuntimeFenceRevoked
		}
		if err := w.whatsapp.assertCapturedConnectionScope(ctx, connectionScope); err != nil {
			return err
		}
		// Kafka is checked last so no Redis/runtime lookup can create a gap
		// between the captured assignment check and the external effect.
		return w.assertKafkaDispatchAuthorized(ctx)
	}
}

func (w *Worker) runKafkaRepublishWithConnectionAuthorization(
	ctx context.Context,
	connectionScope whatsAppRuntimeFence,
	publish func(context.Context) error,
) error {
	if w.whatsapp == nil {
		return errWhatsAppRuntimeFenceRevoked
	}
	if err := w.whatsapp.assertCapturedConnectionScope(ctx, connectionScope); err != nil {
		return err
	}
	return w.runKafkaRepublishAuthorized(ctx, publish)
}

func (w *Worker) connectionFencedProviderBoundary(
	connectionScope whatsAppRuntimeFence,
	boundary providerInvocationBoundary,
) providerInvocationBoundary {
	authorize := w.kafkaAndConnectionAuthorization(connectionScope)
	crossedPointOfNoReturn := false
	return func(ctx context.Context) error {
		if boundary == nil {
			return errors.New("provider invocation boundary is required")
		}
		if crossedPointOfNoReturn {
			return boundary(ctx)
		}
		if err := authorize(ctx); err != nil {
			return err
		}
		if err := boundary(ctx); err != nil {
			return err
		}
		crossedPointOfNoReturn = true
		return nil
	}
}

func (w *Worker) startConsumers(ctx context.Context) ([]KafkaConsumerHandle, *kafkaConsumerSetBarrier, error) {
	if w.workerCommands == nil && w.startWorkerCommandConsumer == nil {
		return nil, nil, errors.New("mandatory JetStream command ingress is unavailable")
	}
	subject := workerCommandSubject(w.cfg.WorkerID)
	durable := workerCommandDurableName(w.cfg.WorkerID)
	barrier := newKafkaConsumerSetBarrier(
		ctx,
		[]string{kafkaConsumerHealthKey(subject, durable)},
		w.observeKafkaConsumerLifecycle,
	)
	startConsumer := w.startWorkerCommandConsumer
	if startConsumer == nil {
		startConsumer = w.workerCommands.StartConsumer
	}
	handle, err := startConsumer(ctx, w, barrier.observe)
	if err != nil {
		return nil, nil, err
	}
	log.Printf(
		"JetStream command consumer starting subject=%s durable=%s stream=%s",
		subject,
		durable,
		workerCommandStreamName,
	)
	return []KafkaConsumerHandle{handle}, barrier, nil
}

func (w *Worker) connectionQRCodeRedisStreamKey(workerID string) string {
	return "connection:qrcode:" + WorkerTypeWhatsmeow + ":" + workerID + ":requests"
}

func (w *Worker) connectionQRCodeRedisStreamGroup(workerID string) string {
	return "connection:qrcode:" + WorkerTypeWhatsmeow + ":" + workerID + ":group"
}

func (w *Worker) connectionQRCodeRedisStreamConsumer(workerID string) string {
	return "whatsmeow:" + workerID
}

func (w *Worker) startConnectionQRCodeRedisStream(ctx context.Context) error {
	if w.redis == nil {
		return fmt.Errorf("redis client is required for connection QR stream")
	}
	streamKey := w.connectionQRCodeRedisStreamKey(w.cfg.WorkerID)
	groupID := w.connectionQRCodeRedisStreamGroup(w.cfg.WorkerID)
	consumerName := w.connectionQRCodeRedisStreamConsumer(w.cfg.WorkerID)

	if err := w.ensureConnectionQRCodeRedisStreamGroup(ctx, streamKey, groupID); err != nil {
		return err
	}
	w.debug.Log(ctx, "whatsmeow.redis_qr.group_ensured", map[string]any{
		"layer":          "worker_whatsmeow.redis_qr",
		"worker_id":      w.cfg.WorkerID,
		"account_id":     w.cfg.AccountID,
		"worker_type_id": WorkerTypeWhatsmeow,
		"stream_key":     streamKey,
		"group_id":       groupID,
		"consumer":       consumerName,
	})

	go w.consumeConnectionQRCodeRedisStream(ctx, streamKey, groupID, consumerName)
	return nil
}

func (w *Worker) consumeConnectionQRCodeRedisStream(ctx context.Context, streamKey, groupID, consumerName string) {
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		claimed, err := w.claimConnectionQRCodeRedisMessages(ctx, streamKey, groupID, consumerName)
		if err != nil && !errors.Is(err, redis.Nil) {
			w.logConnectionQRCodeRedisReadError(ctx, streamKey, groupID, consumerName, err)
			time.Sleep(time.Second)
			continue
		}
		if len(claimed) > 0 {
			w.processConnectionQRCodeRedisMessages(ctx, streamKey, groupID, consumerName, claimed, true)
			continue
		}

		streams, err := w.readConnectionQRCodeRedisMessages(ctx, streamKey, groupID, consumerName)
		if errors.Is(err, redis.Nil) {
			continue
		}
		if err != nil {
			w.logConnectionQRCodeRedisReadError(ctx, streamKey, groupID, consumerName, err)
			time.Sleep(time.Second)
			continue
		}
		for _, stream := range streams {
			w.processConnectionQRCodeRedisMessages(ctx, streamKey, groupID, consumerName, stream.Messages, false)
		}
	}
}

func (w *Worker) ensureConnectionQRCodeRedisStreamGroup(ctx context.Context, streamKey, groupID string) error {
	if w.redis == nil {
		return errors.New("redis client is required for connection QR stream group")
	}
	err := w.redis.XGroupCreateMkStream(ctx, streamKey, groupID, "0").Err()
	if err == nil || strings.Contains(strings.ToUpper(err.Error()), "BUSYGROUP") {
		return nil
	}
	w.debug.Log(ctx, "whatsmeow.redis_qr.group_ensure.error", map[string]any{
		"layer":          "worker_whatsmeow.redis_qr",
		"worker_id":      w.cfg.WorkerID,
		"account_id":     w.cfg.AccountID,
		"worker_type_id": WorkerTypeWhatsmeow,
		"stream_key":     streamKey,
		"group_id":       groupID,
		"error":          err.Error(),
	})
	return err
}

func (w *Worker) recoverConnectionQRCodeRedisStreamGroup(ctx context.Context, streamKey, groupID, consumerName, operation string) error {
	w.debug.Log(ctx, "whatsmeow.redis_qr.group_recovery.start", map[string]any{
		"layer":          "worker_whatsmeow.redis_qr",
		"worker_id":      w.cfg.WorkerID,
		"account_id":     w.cfg.AccountID,
		"worker_type_id": WorkerTypeWhatsmeow,
		"stream_key":     streamKey,
		"group_id":       groupID,
		"consumer":       consumerName,
		"operation":      operation,
	})
	if err := w.ensureConnectionQRCodeRedisStreamGroup(ctx, streamKey, groupID); err != nil {
		return fmt.Errorf("recover connection QR Redis consumer group after %s: %w", operation, err)
	}
	w.debug.Log(ctx, "whatsmeow.redis_qr.group_recovery.done", map[string]any{
		"layer":          "worker_whatsmeow.redis_qr",
		"worker_id":      w.cfg.WorkerID,
		"account_id":     w.cfg.AccountID,
		"worker_type_id": WorkerTypeWhatsmeow,
		"stream_key":     streamKey,
		"group_id":       groupID,
		"consumer":       consumerName,
		"operation":      operation,
	})
	return nil
}

func isConnectionQRCodeRedisNoGroupError(err error) bool {
	return err != nil && strings.Contains(strings.ToUpper(err.Error()), "NOGROUP")
}

func (w *Worker) claimConnectionQRCodeRedisMessages(ctx context.Context, streamKey, groupID, consumerName string) ([]redis.XMessage, error) {
	claim := func() ([]redis.XMessage, error) {
		messages, _, err := w.redis.XAutoClaim(ctx, &redis.XAutoClaimArgs{
			Stream:   streamKey,
			Group:    groupID,
			Consumer: consumerName,
			MinIdle:  3 * time.Second,
			Start:    "0-0",
			Count:    10,
		}).Result()
		return messages, err
	}
	messages, err := claim()
	if !isConnectionQRCodeRedisNoGroupError(err) {
		return messages, err
	}
	if recoveryErr := w.recoverConnectionQRCodeRedisStreamGroup(ctx, streamKey, groupID, consumerName, "XAUTOCLAIM"); recoveryErr != nil {
		return nil, recoveryErr
	}
	return claim()
}

func (w *Worker) readConnectionQRCodeRedisMessages(ctx context.Context, streamKey, groupID, consumerName string) ([]redis.XStream, error) {
	read := func() ([]redis.XStream, error) {
		return w.redis.XReadGroup(ctx, &redis.XReadGroupArgs{
			Group:    groupID,
			Consumer: consumerName,
			Streams:  []string{streamKey, ">"},
			Count:    10,
			Block:    time.Second,
		}).Result()
	}
	streams, err := read()
	if !isConnectionQRCodeRedisNoGroupError(err) {
		return streams, err
	}
	if recoveryErr := w.recoverConnectionQRCodeRedisStreamGroup(ctx, streamKey, groupID, consumerName, "XREADGROUP"); recoveryErr != nil {
		return nil, recoveryErr
	}
	return read()
}

func (w *Worker) processConnectionQRCodeRedisMessages(ctx context.Context, streamKey, groupID, consumerName string, messages []redis.XMessage, reclaimed bool) {
	for _, message := range messages {
		ack, err := w.handleConnectionQRCodeRedisMessage(ctx, streamKey, groupID, consumerName, message, reclaimed)
		if err != nil {
			continue
		}
		if ack {
			w.ackDeleteConnectionQRCodeRedisMessage(ctx, streamKey, groupID, consumerName, message.ID)
		}
	}
}

func (w *Worker) handleConnectionQRCodeRedisMessage(ctx context.Context, streamKey, groupID, consumerName string, message redis.XMessage, reclaimed bool) (ack bool, err error) {
	data, err := workerConnectionQRCodeQueueMessageFromRedis(message)
	if err != nil {
		w.debug.Log(ctx, "whatsmeow.redis_qr.invalid_payload", map[string]any{
			"layer":          "worker_whatsmeow.redis_qr",
			"worker_id":      w.cfg.WorkerID,
			"account_id":     w.cfg.AccountID,
			"worker_type_id": WorkerTypeWhatsmeow,
			"stream_key":     streamKey,
			"group_id":       groupID,
			"consumer":       consumerName,
			"stream_id":      message.ID,
			"error":          err.Error(),
		})
		return true, nil
	}
	w.debug.Log(ctx, "whatsmeow.redis_qr.received", map[string]any{
		"trace_id":                        data.DebugTraceID,
		"layer":                           "worker_whatsmeow.redis_qr",
		"worker_id":                       data.WorkerID,
		"account_id":                      data.AccountID,
		"worker_type_id":                  data.WorkerTypeID,
		"connection_attempt_id":           data.ConnectionAttemptID,
		"authorized_connection_epoch_set": data.AuthorizedConnectionEpoch != "",
		"runtime_generation":              data.RuntimeGeneration,
		"request_id":                      data.RequestID,
		"stream_key":                      streamKey,
		"group_id":                        groupID,
		"consumer":                        consumerName,
		"stream_id":                       message.ID,
		"reclaimed":                       reclaimed,
		"delivery_count":                  w.connectionQRCodeRedisDeliveryCount(ctx, streamKey, groupID, message.ID),
		"queue_latency_ms":                connectionQRCodeQueueLatencyMS(data.RequestedAt),
	})

	req := StatusConnectionRequest{
		WorkerID:                  data.WorkerID,
		Status:                    WorkerStatusOnline,
		Type:                      "qrcode",
		ConnectionAttemptID:       data.ConnectionAttemptID,
		AuthorizedConnectionEpoch: data.AuthorizedConnectionEpoch,
		RuntimeGeneration:         data.RuntimeGeneration,
		DebugTraceID:              data.DebugTraceID,
	}

	if data.WorkerID != w.cfg.WorkerID || data.AccountID != w.cfg.AccountID || data.WorkerTypeID != WorkerTypeWhatsmeow {
		w.debug.Log(ctx, "whatsmeow.redis_qr.skipped_wrong_worker", map[string]any{
			"trace_id":              data.DebugTraceID,
			"layer":                 "worker_whatsmeow.redis_qr",
			"worker_id":             data.WorkerID,
			"account_id":            data.AccountID,
			"worker_type_id":        data.WorkerTypeID,
			"connection_attempt_id": data.ConnectionAttemptID,
			"runtime_generation":    data.RuntimeGeneration,
			"expected_worker_id":    w.cfg.WorkerID,
			"expected_account_id":   w.cfg.AccountID,
			"expected_worker_type":  WorkerTypeWhatsmeow,
		})
		return true, nil
	}

	w.debug.Log(ctx, "whatsmeow.redis_qr.active_check.start", map[string]any{
		"trace_id":              data.DebugTraceID,
		"layer":                 "worker_whatsmeow.redis_qr",
		"worker_id":             data.WorkerID,
		"account_id":            data.AccountID,
		"worker_type_id":        data.WorkerTypeID,
		"connection_attempt_id": data.ConnectionAttemptID,
		"runtime_generation":    data.RuntimeGeneration,
	})
	active, activeErr := w.isActiveConnectionQRCodeAttempt(ctx, data)
	if activeErr != nil {
		err = activeErr
		w.debug.Log(ctx, "whatsmeow.redis_qr.active_check.error", map[string]any{
			"trace_id":              data.DebugTraceID,
			"layer":                 "worker_whatsmeow.redis_qr",
			"worker_id":             data.WorkerID,
			"account_id":            data.AccountID,
			"worker_type_id":        data.WorkerTypeID,
			"connection_attempt_id": data.ConnectionAttemptID,
			"runtime_generation":    data.RuntimeGeneration,
			"error":                 activeErr.Error(),
		})
		return false, activeErr
	}
	if !active {
		w.debug.Log(ctx, "whatsmeow.redis_qr.skipped_inactive_attempt", map[string]any{
			"trace_id":              data.DebugTraceID,
			"layer":                 "worker_whatsmeow.redis_qr",
			"worker_id":             data.WorkerID,
			"account_id":            data.AccountID,
			"worker_type_id":        data.WorkerTypeID,
			"connection_attempt_id": data.ConnectionAttemptID,
			"runtime_generation":    data.RuntimeGeneration,
		})
		return true, nil
	}
	w.debug.Log(ctx, "whatsmeow.redis_qr.active_check.ok", map[string]any{
		"trace_id":              data.DebugTraceID,
		"layer":                 "worker_whatsmeow.redis_qr",
		"worker_id":             data.WorkerID,
		"account_id":            data.AccountID,
		"worker_type_id":        data.WorkerTypeID,
		"connection_attempt_id": data.ConnectionAttemptID,
		"runtime_generation":    data.RuntimeGeneration,
	})

	startedAt := time.Now()
	w.debug.Log(ctx, "whatsmeow.redis_qr.request_connection.start", map[string]any{
		"trace_id":              data.DebugTraceID,
		"layer":                 "worker_whatsmeow.redis_qr",
		"worker_id":             data.WorkerID,
		"account_id":            data.AccountID,
		"worker_type_id":        data.WorkerTypeID,
		"connection_attempt_id": data.ConnectionAttemptID,
		"runtime_generation":    data.RuntimeGeneration,
	})
	state, err := w.RequestConnection(ctx, req)
	if err != nil {
		w.debug.Log(ctx, "whatsmeow.redis_qr.request_connection.error", map[string]any{
			"trace_id":              data.DebugTraceID,
			"layer":                 "worker_whatsmeow.redis_qr",
			"worker_id":             data.WorkerID,
			"account_id":            data.AccountID,
			"worker_type_id":        data.WorkerTypeID,
			"connection_attempt_id": data.ConnectionAttemptID,
			"runtime_generation":    data.RuntimeGeneration,
			"duration_ms":           time.Since(startedAt).Milliseconds(),
			"error":                 err.Error(),
		})
		return false, err
	}
	w.debug.Log(ctx, "whatsmeow.redis_qr.request_connection.response", map[string]any{
		"trace_id":              firstNonEmpty(state.DebugTraceID, data.DebugTraceID),
		"layer":                 "worker_whatsmeow.redis_qr",
		"worker_id":             state.WorkerID,
		"account_id":            state.AccountID,
		"worker_type_id":        WorkerTypeWhatsmeow,
		"connection_attempt_id": firstNonEmpty(state.ConnectionAttemptID, data.ConnectionAttemptID),
		"runtime_generation":    firstNonZero(state.RuntimeGeneration, data.RuntimeGeneration),
		"status":                state.Status,
		"code":                  state.Code,
		"duration_ms":           time.Since(startedAt).Milliseconds(),
		"has_qr":                state.QRCode != "",
		"qr_length":             len(state.QRCode),
		"has_pairing_code":      state.PairingCode != "",
		"pairing_code_length":   len(state.PairingCode),
	})
	if !connectionQRCodeStateBelongsToAttempt(state, data) {
		w.debug.Log(ctx, "whatsmeow.redis_qr.skipped_mismatched_provider_response", map[string]any{
			"trace_id":                        firstNonEmpty(state.DebugTraceID, data.DebugTraceID),
			"layer":                           "worker_whatsmeow.redis_qr",
			"worker_id":                       data.WorkerID,
			"account_id":                      data.AccountID,
			"worker_type_id":                  data.WorkerTypeID,
			"connection_attempt_id":           data.ConnectionAttemptID,
			"authorized_connection_epoch_set": data.AuthorizedConnectionEpoch != "",
			"runtime_generation":              data.RuntimeGeneration,
		})
		return true, nil
	}
	active, activeErr = w.isActiveConnectionQRCodeAttempt(ctx, data)
	if activeErr != nil {
		return false, activeErr
	}
	if !active {
		w.debug.Log(ctx, "whatsmeow.redis_qr.skipped_superseded_provider_response", map[string]any{
			"trace_id":              firstNonEmpty(state.DebugTraceID, data.DebugTraceID),
			"layer":                 "worker_whatsmeow.redis_qr",
			"worker_id":             data.WorkerID,
			"account_id":            data.AccountID,
			"worker_type_id":        data.WorkerTypeID,
			"connection_attempt_id": data.ConnectionAttemptID,
			"runtime_generation":    data.RuntimeGeneration,
		})
		return true, nil
	}
	cached, cacheErr := w.cacheConnectionQRCodeAttemptState(ctx, state, data)
	if cacheErr != nil {
		return false, cacheErr
	}
	if !cached {
		w.debug.Log(ctx, "whatsmeow.redis_qr.skipped_superseded_cache_write", map[string]any{
			"trace_id":              firstNonEmpty(state.DebugTraceID, data.DebugTraceID),
			"layer":                 "worker_whatsmeow.redis_qr",
			"worker_id":             data.WorkerID,
			"account_id":            data.AccountID,
			"worker_type_id":        data.WorkerTypeID,
			"connection_attempt_id": data.ConnectionAttemptID,
			"runtime_generation":    data.RuntimeGeneration,
		})
		return true, nil
	}
	if !connectionQRCodeRequestComplete(state) {
		w.debug.Log(ctx, "whatsmeow.redis_qr.not_complete", map[string]any{
			"trace_id":              firstNonEmpty(state.DebugTraceID, data.DebugTraceID),
			"layer":                 "worker_whatsmeow.redis_qr",
			"worker_id":             data.WorkerID,
			"account_id":            data.AccountID,
			"worker_type_id":        data.WorkerTypeID,
			"connection_attempt_id": data.ConnectionAttemptID,
			"runtime_generation":    data.RuntimeGeneration,
			"status":                state.Status,
			"code":                  state.Code,
		})
		return false, nil
	}
	if err = w.markConnectionQRCodeAttemptProcessed(ctx, data); err != nil {
		w.debug.Log(ctx, "whatsmeow.redis_qr.mark_processed.error", map[string]any{
			"trace_id":              data.DebugTraceID,
			"layer":                 "worker_whatsmeow.redis_qr",
			"worker_id":             data.WorkerID,
			"account_id":            data.AccountID,
			"worker_type_id":        data.WorkerTypeID,
			"connection_attempt_id": data.ConnectionAttemptID,
			"runtime_generation":    data.RuntimeGeneration,
			"error":                 err.Error(),
		})
		return false, err
	}
	return true, nil
}

func connectionQRCodeRequestComplete(state ConnectionState) bool {
	if state.QRCode != "" || state.PairingCode != "" || state.PasskeyPublicKey != "" || state.PasskeyConfirmationCode != "" {
		return true
	}
	if state.Status == "connected" {
		return true
	}
	return state.Status == "disconnected" && state.MaxAttempts > 0 && state.Attempt > state.MaxAttempts
}

func workerConnectionQRCodeQueueMessageFromRedis(message redis.XMessage) (WorkerConnectionQRCodeQueueMessage, error) {
	data := WorkerConnectionQRCodeQueueMessage{
		RequestID:                 redisStreamString(message.Values, "request_id"),
		ConnectionAttemptID:       strings.TrimSpace(redisStreamString(message.Values, "connection_attempt_id")),
		AuthorizedConnectionEpoch: strings.TrimSpace(redisStreamString(message.Values, "authorized_connection_epoch")),
		WorkerID:                  redisStreamString(message.Values, "worker_id"),
		AccountID:                 redisStreamString(message.Values, "account_id"),
		WorkerTypeID:              redisStreamString(message.Values, "worker_type_id"),
		RuntimeGeneration:         redisStreamInt(message.Values, "runtime_generation"),
		Source:                    redisStreamString(message.Values, "source"),
		RequestedAt:               redisStreamString(message.Values, "requested_at"),
		ExpiresAt:                 redisStreamString(message.Values, "expires_at"),
		DebugTraceID:              redisStreamString(message.Values, "debug_trace_id"),
	}
	if data.RequestID == "" || data.ConnectionAttemptID == "" || data.WorkerID == "" || data.AccountID == "" || data.WorkerTypeID == "" || data.RequestedAt == "" {
		return data, fmt.Errorf("missing required redis stream fields")
	}
	if data.AuthorizedConnectionEpoch != "" {
		if _, err := uuid.Parse(data.ConnectionAttemptID); err != nil {
			return data, fmt.Errorf("authorized QR reconnect has invalid connection_attempt_id")
		}
		if _, err := uuid.Parse(data.AuthorizedConnectionEpoch); err != nil {
			return data, fmt.Errorf("authorized QR reconnect has invalid authorized_connection_epoch")
		}
	}
	return data, nil
}

func redisStreamString(values map[string]interface{}, key string) string {
	value, ok := values[key]
	if !ok || value == nil {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return typed
	case []byte:
		return string(typed)
	default:
		return fmt.Sprint(typed)
	}
}

func redisStreamInt(values map[string]interface{}, key string) int {
	raw := strings.TrimSpace(redisStreamString(values, key))
	if raw == "" {
		return 0
	}
	parsed, err := strconv.Atoi(raw)
	if err != nil {
		return 0
	}
	return parsed
}

func connectionQRCodeQueueLatencyMS(requestedAt string) int64 {
	parsed, err := time.Parse(time.RFC3339Nano, requestedAt)
	if err != nil {
		return 0
	}
	return time.Since(parsed).Milliseconds()
}

func (w *Worker) connectionQRCodeRedisDeliveryCount(ctx context.Context, streamKey, groupID, streamID string) int64 {
	pending, err := w.redis.XPendingExt(ctx, &redis.XPendingExtArgs{
		Stream: streamKey,
		Group:  groupID,
		Start:  streamID,
		End:    streamID,
		Count:  1,
	}).Result()
	if err != nil || len(pending) == 0 {
		return 0
	}
	return pending[0].RetryCount
}

func (w *Worker) ackDeleteConnectionQRCodeRedisMessage(ctx context.Context, streamKey, groupID, consumerName, streamID string) {
	_, ackErr := w.redis.XAck(ctx, streamKey, groupID, streamID).Result()
	_, deleteErr := w.redis.XDel(ctx, streamKey, streamID).Result()
	if ackErr != nil || deleteErr != nil {
		w.debug.Log(ctx, "whatsmeow.redis_qr.ack_delete.error", map[string]any{
			"layer":      "worker_whatsmeow.redis_qr",
			"worker_id":  w.cfg.WorkerID,
			"account_id": w.cfg.AccountID,
			"stream_key": streamKey,
			"group_id":   groupID,
			"consumer":   consumerName,
			"stream_id":  streamID,
			"ack_error":  fmt.Sprint(ackErr),
			"del_error":  fmt.Sprint(deleteErr),
		})
		return
	}
	w.debug.Log(ctx, "whatsmeow.redis_qr.ack_deleted", map[string]any{
		"layer":      "worker_whatsmeow.redis_qr",
		"worker_id":  w.cfg.WorkerID,
		"account_id": w.cfg.AccountID,
		"stream_key": streamKey,
		"group_id":   groupID,
		"consumer":   consumerName,
		"stream_id":  streamID,
	})
}

func (w *Worker) logConnectionQRCodeRedisReadError(ctx context.Context, streamKey, groupID, consumerName string, err error) {
	w.debug.Log(ctx, "whatsmeow.redis_qr.read_error", map[string]any{
		"layer":      "worker_whatsmeow.redis_qr",
		"worker_id":  w.cfg.WorkerID,
		"account_id": w.cfg.AccountID,
		"stream_key": streamKey,
		"group_id":   groupID,
		"consumer":   consumerName,
		"error":      err.Error(),
	})
}

type activeConnectionQRCodeAttemptEnvelope struct {
	WorkerTypeID              string `json:"worker_type_id"`
	RuntimeGeneration         int    `json:"runtime_generation"`
	AuthorizedConnectionEpoch string `json:"authorized_connection_epoch"`
	Ack                       struct {
		ConnectionAttemptID       string `json:"connection_attempt_id"`
		WorkerTypeID              string `json:"worker_type_id"`
		RuntimeGeneration         int    `json:"runtime_generation"`
		AuthorizedConnectionEpoch string `json:"authorized_connection_epoch"`
	} `json:"ack"`
}

func (w *Worker) activeConnectionQRCodeAttemptKey(workerID string) string {
	return "connection:qrcode:" + WorkerTypeWhatsmeow + ":" + workerID + ":active_attempt"
}

func (w *Worker) connectionQRCodeAttemptCacheKey(workerID string) string {
	return "connection:qrcode:" + WorkerTypeWhatsmeow + ":" + workerID + ":attempt"
}

func (w *Worker) processedConnectionQRCodeAttemptKey(data WorkerConnectionQRCodeQueueMessage) string {
	return "connection:qrcode:" + data.WorkerTypeID + ":" + data.WorkerID + ":processed:" + data.ConnectionAttemptID
}

func (w *Worker) isActiveConnectionQRCodeAttempt(ctx context.Context, data WorkerConnectionQRCodeQueueMessage) (bool, error) {
	if w.redis == nil {
		return true, nil
	}
	return w.compareConnectionQRCodeAttemptAndMaybeCache(ctx, data, "", 0)
}

func connectionQRCodeStateBelongsToAttempt(state ConnectionState, data WorkerConnectionQRCodeQueueMessage) bool {
	if state.WorkerID != "" && state.WorkerID != data.WorkerID {
		return false
	}
	if state.AccountID != "" && state.AccountID != data.AccountID {
		return false
	}
	if state.WorkerTypeID != "" && state.WorkerTypeID != data.WorkerTypeID {
		return false
	}
	if state.ConnectionAttemptID != "" && state.ConnectionAttemptID != data.ConnectionAttemptID {
		return false
	}
	if data.AuthorizedConnectionEpoch != "" {
		if state.AuthorizedConnectionEpoch != data.AuthorizedConnectionEpoch {
			return false
		}
	} else if state.AuthorizedConnectionEpoch != "" {
		return false
	}
	if data.RuntimeGeneration != 0 && state.RuntimeGeneration != 0 && state.RuntimeGeneration != data.RuntimeGeneration {
		return false
	}
	return true
}

func (w *Worker) compareConnectionQRCodeAttemptAndMaybeCache(
	ctx context.Context,
	data WorkerConnectionQRCodeQueueMessage,
	serializedState string,
	ttl time.Duration,
) (bool, error) {
	if w.redis == nil {
		return true, nil
	}
	mode := "check"
	ttlMilliseconds := int64(1)
	if serializedState != "" {
		mode = "cache"
		ttlMilliseconds = max(ttl.Milliseconds(), 1)
	}
	runtimeGeneration := ""
	if data.RuntimeGeneration != 0 {
		runtimeGeneration = strconv.Itoa(data.RuntimeGeneration)
	}
	result, err := w.redis.Eval(
		ctx,
		connectionQRCodeAttemptCompareAndCacheScript,
		[]string{
			w.activeConnectionQRCodeAttemptKey(data.WorkerID),
			w.connectionQRCodeAttemptCacheKey(data.WorkerID),
			w.processedConnectionQRCodeAttemptKey(data),
		},
		data.ConnectionAttemptID,
		data.WorkerTypeID,
		runtimeGeneration,
		data.AuthorizedConnectionEpoch,
		mode,
		serializedState,
		strconv.FormatInt(ttlMilliseconds, 10),
	).Int64()
	if err != nil {
		return false, err
	}
	return result == 1, nil
}

func (w *Worker) cacheConnectionQRCodeAttemptState(ctx context.Context, state ConnectionState, data WorkerConnectionQRCodeQueueMessage) (bool, error) {
	if w.redis == nil || (state.QRCode == "" && state.PairingCode == "" && state.PasskeyPublicKey == "" && state.PasskeyConfirmationCode == "") {
		return true, nil
	}

	normalized := state
	if normalized.WorkerID == "" {
		normalized.WorkerID = data.WorkerID
	}
	if normalized.AccountID == "" {
		normalized.AccountID = data.AccountID
	}
	normalized.WorkerTypeID = WorkerTypeWhatsmeow
	if normalized.DebugTraceID == "" {
		normalized.DebugTraceID = data.DebugTraceID
	}
	if normalized.RuntimeGeneration == 0 {
		normalized.RuntimeGeneration = data.RuntimeGeneration
	}
	if normalized.ConnectionAttemptID == "" {
		normalized.ConnectionAttemptID = data.ConnectionAttemptID
	}
	if normalized.AuthorizedConnectionEpoch == "" {
		normalized.AuthorizedConnectionEpoch = data.AuthorizedConnectionEpoch
	}
	if normalized.QRGeneratedAt == "" {
		normalized.QRGeneratedAt = time.Now().UTC().Format(time.RFC3339Nano)
	}
	if normalized.ExpiresAt == "" {
		if generatedAt, err := time.Parse(time.RFC3339Nano, normalized.QRGeneratedAt); err == nil {
			normalized.ExpiresAt = generatedAt.Add(connectionQRCodeMaxAge).UTC().Format(time.RFC3339Nano)
		}
	}
	normalized.QRPending = false

	ttl := connectionQRCodeCacheTTLForState(normalized)
	payload, err := json.Marshal(normalized)
	if err != nil {
		return false, err
	}

	cached, err := w.compareConnectionQRCodeAttemptAndMaybeCache(ctx, data, string(payload), ttl)
	if err != nil {
		w.debug.Log(ctx, "whatsmeow.redis_qr.cache_state.error", map[string]any{
			"trace_id":              normalized.DebugTraceID,
			"layer":                 "worker_whatsmeow.redis_qr",
			"worker_id":             normalized.WorkerID,
			"account_id":            normalized.AccountID,
			"worker_type_id":        normalized.WorkerTypeID,
			"connection_attempt_id": normalized.ConnectionAttemptID,
			"runtime_generation":    normalized.RuntimeGeneration,
			"status":                normalized.Status,
			"code":                  normalized.Code,
			"error":                 err.Error(),
		})
		return false, err
	}
	if !cached {
		return false, nil
	}
	w.debug.Log(ctx, "whatsmeow.redis_qr.cache_state.saved", map[string]any{
		"trace_id":                      normalized.DebugTraceID,
		"layer":                         "worker_whatsmeow.redis_qr",
		"worker_id":                     normalized.WorkerID,
		"account_id":                    normalized.AccountID,
		"worker_type_id":                normalized.WorkerTypeID,
		"connection_attempt_id":         normalized.ConnectionAttemptID,
		"runtime_generation":            normalized.RuntimeGeneration,
		"status":                        normalized.Status,
		"code":                          normalized.Code,
		"ttl_ms":                        ttl.Milliseconds(),
		"has_qr":                        normalized.QRCode != "",
		"qr_length":                     len(normalized.QRCode),
		"has_pairing_code":              normalized.PairingCode != "",
		"pairing_code_length":           len(normalized.PairingCode),
		"has_passkey_public_key":        normalized.PasskeyPublicKey != "",
		"passkey_public_key_len":        len(normalized.PasskeyPublicKey),
		"has_passkey_confirmation_code": normalized.PasskeyConfirmationCode != "",
	})
	return true, nil
}

func connectionQRCodeCacheTTLForState(state ConnectionState) time.Duration {
	if state.QRCode == "" || state.QRGeneratedAt == "" {
		return connectionQRCodeCacheTTL
	}

	generatedAt, err := time.Parse(time.RFC3339Nano, state.QRGeneratedAt)
	if err != nil {
		return connectionQRCodeCacheTTL
	}

	remaining := connectionQRCodeMaxAge - time.Since(generatedAt)
	if remaining < time.Second {
		return time.Second
	}
	if remaining < connectionQRCodeCacheTTL {
		return remaining
	}
	return connectionQRCodeCacheTTL
}

func (w *Worker) markConnectionQRCodeAttemptProcessed(ctx context.Context, data WorkerConnectionQRCodeQueueMessage) error {
	if w.redis == nil {
		return nil
	}
	err := w.redis.Set(ctx, w.processedConnectionQRCodeAttemptKey(data), "1", 5*time.Minute).Err()
	if err == nil {
		w.debug.Log(ctx, "whatsmeow.redis_qr.mark_processed.ok", map[string]any{
			"trace_id":              data.DebugTraceID,
			"layer":                 "worker_whatsmeow.redis_qr",
			"worker_id":             data.WorkerID,
			"account_id":            data.AccountID,
			"worker_type_id":        data.WorkerTypeID,
			"connection_attempt_id": data.ConnectionAttemptID,
			"runtime_generation":    data.RuntimeGeneration,
		})
	}
	return err
}

func (w *Worker) outboundProviderAdmissionSlots() chan struct{} {
	w.providerSendAdmissionOnce.Do(func() {
		w.providerSendAdmission = make(
			chan struct{},
			normalizeProviderSendMaxInFlight(w.cfg.ProviderSendMaxInFlight),
		)
	})
	return w.providerSendAdmission
}

func (w *Worker) acquireOutboundProviderAdmission(
	ctx context.Context,
) (func(), error) {
	if ctx == nil {
		return func() {}, errOutboundProviderAdmissionUnavailable
	}
	slots := w.outboundProviderAdmissionSlots()
	select {
	case slots <- struct{}{}:
		var releaseOnce sync.Once
		return func() {
			releaseOnce.Do(func() {
				<-slots
			})
		}, nil
	case <-ctx.Done():
		return func() {}, errors.Join(
			errOutboundProviderAdmissionUnavailable,
			ctx.Err(),
		)
	}
}

func (w *Worker) handleSendMessage(ctx context.Context, msg kafka.Message) (err error) {
	w.logOutgoingKafkaRawDebug("whatsmeow.outgoing.kafka.received_raw", msg)

	if statusDelete, ok, err := mapToProfileStatusDeleteMessage(msg.Value); err != nil {
		logKafkaPayloadDecodeError(w.cfg.WorkerID, msg, err)
		w.logOutgoingKafkaDecodeErrorDebug(msg, err)
		return nil
	} else if ok {
		w.logOutgoingKafkaDecodedDebug(msg, "profile_status_delete", statusDelete.WorkerProfileStatusID, "", "profile_status_delete", statusDelete.AccountID)
		return w.handleProfileStatusDelete(ctx, msg, statusDelete)
	}

	if status, ok, err := mapToProfileStatusMessage(msg.Value); err != nil {
		logKafkaPayloadDecodeError(w.cfg.WorkerID, msg, err)
		w.logOutgoingKafkaDecodeErrorDebug(msg, err)
		return nil
	} else if ok {
		w.logOutgoingKafkaDecodedDebug(msg, "profile_status", status.WorkerProfileStatusID, "", "profile_status", status.AccountID)
		return w.handleProfileStatus(ctx, msg, status)
	}

	if profileInfo, ok, err := mapToProfileInfoMessage(msg.Value); err != nil {
		logKafkaPayloadDecodeError(w.cfg.WorkerID, msg, err)
		w.logOutgoingKafkaDecodeErrorDebug(msg, err)
		return nil
	} else if ok {
		w.logOutgoingKafkaDecodedDebug(msg, "profile_info", firstNonEmpty(profileInfo.WorkerID, w.cfg.WorkerID), "", "profile_info", profileInfo.AccountID)
		return w.handleProfileInfo(ctx, msg, profileInfo)
	}

	data, err := mapToChatMessage(msg.Value)
	if err != nil {
		logKafkaPayloadDecodeError(w.cfg.WorkerID, msg, err)
		w.logOutgoingKafkaDecodeErrorDebug(msg, err)
		return nil
	}
	if err := w.validateOutboundPayloadIdentity(
		"chat_message",
		[]string{stringValue(data.Account["id"])},
		[]string{stringValue(data.Worker["id"])},
	); err != nil {
		return w.discardInvalidOutboundPayload(msg, "chat_message", err)
	}
	if strings.TrimSpace(data.MessageID) == "" {
		return w.discardInvalidOutboundPayload(
			msg,
			"chat_message",
			errors.New("message_id is required"),
		)
	}
	data.MessageID = strings.TrimSpace(data.MessageID)
	w.logOutgoingKafkaDecodedDebug(msg, "chat_message", data.MessageID, data.ChatID, chatMessageType(data), firstNonEmpty(stringValue(data.Account["id"]), w.cfg.AccountID))

	if err := w.waitOutboundReady(ctx, data, msg); err != nil {
		return err
	}
	connectionScope, err := w.whatsapp.captureActiveConnectionScope(ctx)
	if err != nil {
		return err
	}
	fencedCtx := withInboundConnectionScope(ctx, connectionScope)
	authorizeProvider := w.kafkaAndConnectionAuthorization(connectionScope)
	assignmentEpoch, err := w.kafkaDispatchAssignmentEpoch(ctx)
	if err != nil {
		return err
	}
	releaseProviderAdmission, err := w.acquireOutboundProviderAdmission(ctx)
	if err != nil {
		return restartKafkaGenerationWithoutCommit(fmt.Errorf(
			"acquire direct-send provider admission: %w",
			err,
		))
	}
	defer releaseProviderAdmission()
	if err := authorizeProvider(ctx); err != nil {
		return restartKafkaGenerationWithoutCommit(fmt.Errorf(
			"revalidate direct-send provider authorization after admission: %w",
			err,
		))
	}

	operation := outboundSendOperation{
		AccountID: w.cfg.AccountID,
		Type:      "direct",
		ID:        outboundOperationIDFromMessage(msg, chatMessageOperationID(data)),
	}
	w.logOutgoingMessageStepDebug("whatsmeow.outgoing.claim.start", msg, data, map[string]any{"claim_id": operation.ID}, nil)
	meta := outboundOperationMeta(msg, operation.AccountID, w.cfg.WorkerID, data.MessageID, data.ChatID)
	meta["consumer_assignment_epoch"] = assignmentEpoch
	claim, err := w.claimOutboundOperation(ctx, operation, meta)
	if err != nil {
		w.logOutgoingMessageStepDebug("whatsmeow.outgoing.claim.error", msg, data, map[string]any{"claim_id": operation.ID}, err)
		if errors.Is(err, errOutboundIdempotencyIdentityConflict) {
			return w.publishDirectIdentityConflictStatus(
				fencedCtx,
				connectionScope,
				data,
				err,
			)
		}
		return err
	}
	if !claim.Acquired {
		if claim.State == sendIdempotencyStateSucceeded ||
			claim.State == sendIdempotencyStateFailed ||
			claim.State == sendIdempotencyStateAmbiguous {
			if claim.Recovery != nil {
				if err := w.publishAndAcknowledgeOutboundRecovery(ctx, claim, *claim.Recovery); err != nil {
					if claim.State == sendIdempotencyStateAmbiguous {
						log.Printf("whatsmeow durable ambiguous send recovery remains pending worker_id=%s message_id_hash=%s key_hash=%s error_code=%s", w.cfg.WorkerID, hashConnectionFlowIdentifier(data.MessageID), hashConnectionFlowIdentifier(claim.Key), safeOperationalErrorCode(err))
						return err
					}
					if errors.Is(err, errKafkaConsumerDispatchRevoked) ||
						errors.Is(err, errWhatsAppRuntimeFenceRevoked) ||
						errors.Is(err, errOutboundRecoveryObsolete) {
						log.Printf("whatsmeow obsolete durable send recovery discarded worker_id=%s message_id_hash=%s key_hash=%s error_code=%s", w.cfg.WorkerID, hashConnectionFlowIdentifier(data.MessageID), hashConnectionFlowIdentifier(claim.Key), safeOperationalErrorCode(err))
						return nil
					}
					log.Printf("whatsmeow durable send recovery remains pending worker_id=%s message_id_hash=%s key_hash=%s error_code=%s", w.cfg.WorkerID, hashConnectionFlowIdentifier(data.MessageID), hashConnectionFlowIdentifier(claim.Key), safeOperationalErrorCode(err))
				}
				return nil
			}
		}
		claimErr := w.resolveUnacquiredOutboundClaim(ctx, claim)
		w.logOutgoingMessageStepDebug("whatsmeow.outgoing.claim.duplicate", msg, data, map[string]any{"claim_id": operation.ID, "claim_state": claim.State, "reason": "duplicate_message"}, claimErr)
		return claimErr
	}
	w.logOutgoingMessageStepDebug("whatsmeow.outgoing.claim.acquired", msg, data, map[string]any{"claim_id": operation.ID, "claim_state": claim.State}, nil)
	if err := w.prepareOutboundRecovery(ctx, claim); err != nil {
		w.releaseOutboundReservationBestEffort(ctx, claim, true)
		return err
	}
	ambiguousRecovery, err := newOutboundAmbiguousRecovery(
		w.cfg.WorkerID,
		operation.AccountID,
		assignmentEpoch,
		connectionScope,
		data.MessageID,
		data.ChatID,
		nil,
	)
	if err != nil {
		w.releaseOutboundReservationBestEffort(ctx, claim, true)
		return err
	}
	fencedCtx = withOutboundProviderStallHandler(
		fencedCtx,
		w.outboundProviderStallTerminalizer(claim, ambiguousRecovery),
	)
	startedAt := time.Now()
	w.logOutgoingMessageStepDebug("whatsmeow.outgoing.send.invoke", msg, data, map[string]any{"claim_id": operation.ID}, nil)
	providerInvoked := false
	result, err := w.whatsapp.SendChatMessageWithInvocationBoundary(fencedCtx, data, authorizeProvider, func(boundaryCtx context.Context) error {
		if err := w.markOutboundProviderInvokedWithRecoveryAndDispatchFence(
			boundaryCtx,
			claim,
			&providerInvoked,
			ambiguousRecovery,
			authorizeProvider,
		); err != nil {
			return err
		}
		providerInvoked = true
		return nil
	})
	// Admission protects provider preparation and the provider call, not the
	// durable Redis/Kafka post-effects. Release it as soon as the call settles.
	releaseProviderAdmission()
	if err != nil {
		w.logOutgoingMessageStepDebug("whatsmeow.outgoing.send.error", msg, data, map[string]any{"claim_id": operation.ID, "elapsed_ms": time.Since(startedAt).Milliseconds()}, err)
		if !providerInvoked && !isPermanentOutboundPreProviderFailure(err) {
			w.logOutgoingMessageStepDebug("whatsmeow.outgoing.send.retry_pre_provider", msg, data, map[string]any{
				"claim_id":      operation.ID,
				"elapsed_ms":    time.Since(startedAt).Milliseconds(),
				"failure_scope": "transient_pre_provider",
			}, err)
			return w.retryTransientOutboundPreProviderFailure(
				ctx,
				claim,
				true,
				err,
			)
		}
		return terminalizeOutboundProviderFailure(
			providerInvoked,
			func() error {
				terminalizeErr := w.terminalizeDirectPreProviderFailure(
					ctx,
					claim,
					assignmentEpoch,
					connectionScope,
					data,
					err,
					sendFailureLogContext{
						Topic:        msg.Topic,
						Partition:    msg.Partition,
						Offset:       msg.Offset,
						MessageType:  chatMessageType(data),
						Elapsed:      time.Since(startedAt),
						SendTimeout:  w.cfg.SendTimeout,
						HandlerScope: "send_message",
					},
				)
				if terminalizeErr != nil {
					w.logOutgoingMessageStepDebug("whatsmeow.outgoing.status_failed_recovery.error", msg, data, map[string]any{"claim_id": operation.ID, "elapsed_ms": time.Since(startedAt).Milliseconds()}, terminalizeErr)
					return terminalizeErr
				}
				w.logOutgoingMessageStepDebug("whatsmeow.outgoing.send.failed_recovery_queued", msg, data, map[string]any{"claim_id": operation.ID, "elapsed_ms": time.Since(startedAt).Milliseconds(), "failure_scope": "pre_provider"}, err)
				return nil
			},
			func() error {
				ambiguousErr := w.persistAndPublishOutboundAmbiguous(
					ctx,
					claim,
					err,
					ambiguousRecovery,
				)
				if ambiguousErr != nil {
					return ambiguousErr
				}
				w.logOutgoingMessageStepDebug("whatsmeow.outgoing.send.ambiguous_terminal", msg, data, map[string]any{
					"claim_id":   operation.ID,
					"elapsed_ms": time.Since(startedAt).Milliseconds(),
					"reason":     "provider_invoked_without_definitive_outcome",
				}, err)
				return nil
			},
		)
	}
	update := UpdateMessage{
		WorkerID:          w.cfg.WorkerID,
		SourceProvider:    "whatsmeow",
		RuntimeGeneration: connectionScope.RuntimeGeneration,
		ConnectionEpoch:   connectionScope.ConnectionEpoch,
		Message:           result,
		Data:              data,
	}
	ensureMessageUpdateEventID(&update)
	updatePublication, err := newOutboundRecoveryPublication(
		topicUpdateMessage,
		outboundUpdateKafkaKey(operation.AccountID, w.cfg.WorkerID, data.MessageID),
		update,
	)
	if err != nil {
		return err
	}
	recovery := outboundRecoveryRecord{
		SchemaVersion:           outboundRecoverySchemaVersion,
		WorkerID:                w.cfg.WorkerID,
		AccountID:               operation.AccountID,
		ConsumerAssignmentEpoch: assignmentEpoch,
		OriginRuntimeGeneration: connectionScope.RuntimeGeneration,
		OriginConnectionEpoch:   connectionScope.ConnectionEpoch,
		Publications:            []outboundRecoveryPublication{updatePublication},
	}
	if err := persistOutboundProviderOutcome(ctx, func(attemptCtx context.Context) error {
		return w.completeOutboundSuccessWithRecovery(attemptCtx, claim, map[string]any{"update_message": update}, recovery)
	}); err != nil {
		return err
	}
	w.logOutgoingMessageStepDebug("whatsmeow.outgoing.send.success", msg, data, map[string]any{
		"claim_id":            operation.ID,
		"elapsed_ms":          time.Since(startedAt).Milliseconds(),
		"external_message_id": messageKeyFromSendResult(result),
	}, nil)
	w.logOutgoingMessageStepDebug("whatsmeow.outgoing.update.publish.start", msg, data, map[string]any{"topic": topicUpdateMessage}, nil)
	if err := w.publishAndAcknowledgeOutboundRecovery(ctx, claim, recovery); err != nil {
		log.Printf(
			"whatsmeow send update publish failed worker_id=%s account_id=%s source_topic=%s partition=%d offset=%d message_id_hash=%s chat_id_hash=%s message_type=%s topic=%s error_code=%s",
			w.cfg.WorkerID,
			w.cfg.AccountID,
			msg.Topic,
			msg.Partition,
			msg.Offset,
			hashConnectionFlowIdentifier(data.MessageID),
			hashConnectionFlowIdentifier(data.ChatID),
			chatMessageType(data),
			topicUpdateMessage,
			safeOperationalErrorCode(err),
		)
		w.logOutgoingMessageStepDebug("whatsmeow.outgoing.update.publish.error", msg, data, map[string]any{"topic": topicUpdateMessage}, err)
		// The source offset may now be committed safely: the provider result and
		// exact publication payload are durable in Redis and the recovery loop
		// never invokes the provider.
		return nil
	}
	w.logOutgoingMessageStepDebug("whatsmeow.outgoing.update.publish.success", msg, data, map[string]any{"topic": topicUpdateMessage}, nil)
	w.logOutgoingMessageStepDebug("whatsmeow.outgoing.kafka.commit.ready", msg, data, nil, nil)
	return nil
}

func (w *Worker) waitOutboundReady(ctx context.Context, data ChatMessage, msg kafka.Message) error {
	w.logOutgoingMessageStepDebug("whatsmeow.outgoing.connection.wait.start", msg, data, map[string]any{"timeout_ms": w.cfg.OutboundReadyTimeout.Milliseconds()}, nil)
	if err := w.whatsapp.WaitUntilReady(ctx, w.cfg.OutboundReadyTimeout); err != nil {
		w.logOutgoingMessageStepDebug("whatsmeow.outgoing.connection.wait", msg, data, map[string]any{"timeout_ms": w.cfg.OutboundReadyTimeout.Milliseconds(), "reason": "connection_not_ready"}, err)
		return err
	}
	w.logOutgoingMessageStepDebug("whatsmeow.outgoing.connection.ready", msg, data, nil, nil)
	return nil
}

func (w *Worker) handleProfileStatus(ctx context.Context, msg kafka.Message, data ProfileStatusMessage) error {
	if err := w.validateOutboundPayloadIdentity(
		"profile_status",
		[]string{data.AccountID},
		[]string{data.WorkerID},
	); err != nil {
		return w.discardInvalidOutboundPayload(msg, "profile_status", err)
	}
	connectionScope, err := w.whatsapp.captureActiveConnectionScope(ctx)
	if err != nil {
		return err
	}
	fencedCtx := withInboundConnectionScope(ctx, connectionScope)
	messageID := firstNonEmpty(data.WorkerProfileStatusID, "profile_status")
	startedAt := time.Now()
	externalID := ""
	return w.processProviderCommandWithIdempotency(
		fencedCtx,
		msg,
		data.AccountID,
		firstNonEmpty(data.WorkerID, w.cfg.WorkerID),
		func(boundary providerInvocationBoundary) error {
			fencedBoundary := w.connectionFencedProviderBoundary(connectionScope, boundary)
			result, err := w.whatsapp.SendProfileStatusWithInvocationBoundary(fencedCtx, data, fencedBoundary)
			if err != nil {
				return err
			}
			externalID, err = requireProfileStatusExternalID(result)
			if err != nil {
				// SendProfileStatusWithInvocationBoundary crossed the durable
				// provider boundary before returning this result. Treat a
				// missing acknowledgement identity as an ambiguous provider
				// outcome; processProviderCommandWithIdempotency will persist
				// provider_invoked -> ambiguous and never call WhatsApp again.
				return err
			}
			return nil
		},
		func(sendErr error) error {
			if !isPermanentOutboundPreProviderFailure(sendErr) {
				return restartKafkaGenerationWithoutCommit(fmt.Errorf(
					"transient profile status pre-provider failure: %w",
					nonTerminalKafkaHandlerCause(sendErr),
				))
			}
			return w.markSendAsNotSent(fencedCtx, messageID, "", data.AccountID, sendErr, sendFailureLogContext{
				Topic:        msg.Topic,
				Partition:    msg.Partition,
				Offset:       msg.Offset,
				MessageType:  "profile_status",
				Elapsed:      time.Since(startedAt),
				SendTimeout:  w.cfg.SendTimeout,
				HandlerScope: "profile_status",
			})
		},
		providerCommandDurableSuccess{
			result: func() map[string]any {
				return map[string]any{"external_id": externalID}
			},
			after: func(durableClaim outboundSendClaim) error {
				durableExternalID := strings.TrimSpace(stringValue(durableClaim.Result["external_id"]))
				if durableExternalID == "" {
					durableExternalID = strings.TrimSpace(externalID)
				}
				if durableExternalID == "" {
					return nil
				}
				if err := w.runKafkaRepublishWithConnectionAuthorization(fencedCtx, connectionScope, func(publishCtx context.Context) error {
					return w.kafka.SendJSON(publishCtx, topicUpdateProfileStatusExternalID, w.cfg.AccountID+":"+w.cfg.WorkerID+":"+data.WorkerProfileStatusID, map[string]any{
						"worker_profile_status_id": data.WorkerProfileStatusID,
						"external_id":              durableExternalID,
						"event_id":                 strings.Join([]string{"profile-status-external-id", "v1", w.cfg.AccountID, w.cfg.WorkerID, data.WorkerProfileStatusID, durableExternalID}, ":"),
						"account_id":               w.cfg.AccountID,
						"worker_id":                w.cfg.WorkerID,
						"source_provider":          connectionScope.SourceProvider,
						"runtime_generation":       connectionScope.RuntimeGeneration,
						"connection_epoch":         connectionScope.ConnectionEpoch,
					})
				}); err != nil {
					log.Printf("whatsmeow profile status external id publish failed worker_id=%s source_topic=%s partition=%d offset=%d profile_status_id_hash=%s topic=%s error_code=%s", w.cfg.WorkerID, msg.Topic, msg.Partition, msg.Offset, hashConnectionFlowIdentifier(data.WorkerProfileStatusID), topicUpdateProfileStatusExternalID, safeOperationalErrorCode(err))
					return err
				}
				return nil
			},
		},
	)
}

func requireProfileStatusExternalID(externalID string) (string, error) {
	externalID = strings.TrimSpace(externalID)
	if externalID == "" {
		return "", errors.New("profile status provider acknowledgement is missing external_id")
	}
	return externalID, nil
}

func (w *Worker) handleProfileStatusDelete(ctx context.Context, msg kafka.Message, data ProfileStatusDeleteMessage) error {
	if err := w.validateOutboundPayloadIdentity(
		"profile_status_delete",
		[]string{data.AccountID},
		[]string{data.WorkerID},
	); err != nil {
		return w.discardInvalidOutboundPayload(msg, "profile_status_delete", err)
	}
	connectionScope, err := w.whatsapp.captureActiveConnectionScope(ctx)
	if err != nil {
		return err
	}
	fencedCtx := withInboundConnectionScope(ctx, connectionScope)
	messageID := firstNonEmpty(data.WorkerProfileStatusID, "profile_status_delete")
	startedAt := time.Now()
	return w.processProviderCommandWithIdempotency(
		fencedCtx,
		msg,
		data.AccountID,
		firstNonEmpty(data.WorkerID, w.cfg.WorkerID),
		func(boundary providerInvocationBoundary) error {
			fencedBoundary := w.connectionFencedProviderBoundary(connectionScope, boundary)
			if err := w.whatsapp.DeleteProfileStatusWithInvocationBoundary(fencedCtx, data, fencedBoundary); err != nil {
				return err
			}
			return nil
		},
		func(sendErr error) error {
			if !isPermanentOutboundPreProviderFailure(sendErr) {
				return restartKafkaGenerationWithoutCommit(fmt.Errorf(
					"transient profile status delete pre-provider failure: %w",
					nonTerminalKafkaHandlerCause(sendErr),
				))
			}
			return w.markSendAsNotSent(fencedCtx, messageID, "", data.AccountID, sendErr, sendFailureLogContext{
				Topic:        msg.Topic,
				Partition:    msg.Partition,
				Offset:       msg.Offset,
				MessageType:  "profile_status_delete",
				Elapsed:      time.Since(startedAt),
				SendTimeout:  w.cfg.SendTimeout,
				HandlerScope: "profile_status_delete",
			})
		},
	)
}

type profileInfoSuboperation struct {
	ID      string
	Payload ProfileInfoMessage
}

const profileInfoSuboperationTopicSeparator = "#profile-info:"

func profileInfoSuboperations(data ProfileInfoMessage) []profileInfoSuboperation {
	operations := make([]profileInfoSuboperation, 0, 3)
	base := ProfileInfoMessage{
		WorkerID:  data.WorkerID,
		AccountID: data.AccountID,
	}
	if strings.TrimSpace(data.Name) != "" {
		name := base
		name.Name = data.Name
		operations = append(operations, profileInfoSuboperation{
			ID:      "name",
			Payload: name,
		})
	}
	if strings.TrimSpace(data.Message) != "" {
		status := base
		status.Message = data.Message
		operations = append(operations, profileInfoSuboperation{
			ID:      "status",
			Payload: status,
		})
	}
	if data.PhotoPresent {
		photo := base
		photo.Photo = data.Photo
		photo.PhotoPresent = true
		photo.PhotoRemove = data.PhotoRemove
		operations = append(operations, profileInfoSuboperation{
			ID:      "photo",
			Payload: photo,
		})
	}
	return operations
}

func runProfileInfoSuboperations(
	data ProfileInfoMessage,
	run func(profileInfoSuboperation) error,
) error {
	if run == nil {
		return errors.New("profile info suboperation runner is required")
	}
	for _, operation := range profileInfoSuboperations(data) {
		if err := run(operation); err != nil {
			return err
		}
	}
	return nil
}

func profileInfoSuboperationMessage(msg kafka.Message, suboperationID string) kafka.Message {
	suboperation := msg
	suboperation.Topic = msg.Topic + profileInfoSuboperationTopicSeparator + suboperationID
	suboperation.Headers = append([]kafka.Header(nil), msg.Headers...)
	for index := range suboperation.Headers {
		if suboperation.Headers[index].Key != workerCommandHeaderOperationID {
			continue
		}
		baseOperationID := strings.TrimSpace(string(suboperation.Headers[index].Value))
		if baseOperationID != "" {
			suboperation.Headers[index].Value = []byte(strings.Join(
				[]string{baseOperationID, "profile-info", suboperationID},
				"\x00",
			))
		}
		break
	}
	return suboperation
}

// resolveLegacyProfileInfoOperation protects the rolling transition from the
// former compound ledger. A terminal legacy record represents an invocation
// which may already have applied every requested effect, so child operations
// must not replay it. An expired reservation provably did not cross the old
// provider boundary and is removed before the new child ledgers are created.
func (w *Worker) resolveLegacyProfileInfoOperation(
	ctx context.Context,
	msg kafka.Message,
	accountID string,
	workerID string,
) (bool, error) {
	operation := outboundSendOperation{
		AccountID: strings.TrimSpace(accountID),
		Type:      "direct",
		ID:        workerCommandOperationID(msg),
	}
	key, err := outboundSendIdempotencyKey(operation)
	if err != nil {
		return false, err
	}
	if w.redis == nil {
		return false, errors.New("redis is required for profile info idempotency")
	}
	redisCtx, cancel := withOutboundRedisOperationDeadline(ctx)
	exists, err := w.redis.Exists(redisCtx, key).Result()
	cancel()
	if err != nil {
		return false, fmt.Errorf("inspect legacy profile info idempotency: %w", err)
	}
	if exists == 0 {
		return false, nil
	}

	assignmentEpoch, err := w.kafkaDispatchAssignmentEpoch(ctx)
	if err != nil {
		return false, err
	}
	claim, err := w.claimOutboundOperation(ctx, operation, map[string]any{
		"provider":                  "whatsmeow",
		"account_id":                operation.AccountID,
		"worker_id":                 workerID,
		"source_topic":              msg.Topic,
		"source_partition":          msg.Partition,
		"source_offset":             msg.Offset,
		"consumer_assignment_epoch": assignmentEpoch,
	})
	if err != nil {
		if errors.Is(err, errOutboundIdempotencyIdentityConflict) {
			log.Printf(
				"whatsmeow legacy profile info immutable identity conflict discarded worker_id=%s account_id=%s topic=%s partition=%d offset=%d error_code=%s",
				workerID,
				operation.AccountID,
				msg.Topic,
				msg.Partition,
				msg.Offset,
				err,
			)
			return true, nil
		}
		return false, err
	}
	if claim.Acquired {
		if err := w.releaseOutboundReservation(ctx, claim, false); err != nil {
			return false, err
		}
		return false, nil
	}
	switch claim.State {
	case sendIdempotencyStateSucceeded, sendIdempotencyStateFailed, sendIdempotencyStateAmbiguous:
		return true, nil
	default:
		return false, w.resolveUnacquiredOutboundClaim(ctx, claim)
	}
}

func (w *Worker) handleProfileInfo(ctx context.Context, msg kafka.Message, data ProfileInfoMessage) error {
	if err := w.validateOutboundPayloadIdentity(
		"profile_info",
		[]string{data.AccountID},
		[]string{data.WorkerID},
	); err != nil {
		return w.discardInvalidOutboundPayload(msg, "profile_info", err)
	}
	connectionScope, err := w.whatsapp.captureActiveConnectionScope(ctx)
	if err != nil {
		return err
	}
	fencedCtx := withInboundConnectionScope(ctx, connectionScope)
	workerID := firstNonEmpty(data.WorkerID, w.cfg.WorkerID)
	legacyTerminal, err := w.resolveLegacyProfileInfoOperation(
		fencedCtx,
		msg,
		data.AccountID,
		workerID,
	)
	if err != nil || legacyTerminal {
		return err
	}
	return runProfileInfoSuboperations(data, func(operation profileInfoSuboperation) error {
		suboperationMessage := profileInfoSuboperationMessage(msg, operation.ID)
		return w.processProviderCommandWithIdempotency(
			fencedCtx,
			suboperationMessage,
			data.AccountID,
			workerID,
			func(boundary providerInvocationBoundary) error {
				fencedBoundary := w.connectionFencedProviderBoundary(connectionScope, boundary)
				return w.whatsapp.UpdateProfileInfoWithInvocationBoundary(
					fencedCtx,
					operation.Payload,
					fencedBoundary,
				)
			},
			func(updateErr error) error {
				if !isPermanentOutboundPreProviderFailure(updateErr) {
					return restartKafkaGenerationWithoutCommit(fmt.Errorf(
						"transient profile info %s pre-provider failure: %w",
						operation.ID,
						nonTerminalKafkaHandlerCause(updateErr),
					))
				}
				log.Printf(
					"whatsmeow profile info suboperation terminally discarded worker_id=%s account_id=%s suboperation=%s topic=%s partition=%d offset=%d error_code=%s",
					workerID,
					data.AccountID,
					operation.ID,
					msg.Topic,
					msg.Partition,
					msg.Offset,
					safeOperationalErrorCode(updateErr),
				)
				return nil
			},
		)
	})
}

func (w *Worker) handleScheduleSend(ctx context.Context, msg kafka.Message) error {
	w.logOutgoingKafkaRawDebug("whatsmeow.outgoing.schedule.kafka.received_raw", msg)
	var data ScheduleMessage
	if err := json.Unmarshal(msg.Value, &data); err != nil {
		logKafkaPayloadDecodeError(w.cfg.WorkerID, msg, err)
		w.logOutgoingKafkaDecodeErrorDebug(msg, err)
		return nil
	}
	data.AttemptID = strings.TrimSpace(data.AttemptID)
	data.OperationID = outboundOperationIDFromMessage(msg, data.OperationID)
	if err := w.validateOutboundPayloadIdentity(
		"schedule_message",
		[]string{data.AccountID, stringValue(data.Message.Account["id"])},
		[]string{stringValue(data.Message.Worker["id"])},
	); err != nil {
		return w.discardInvalidOutboundPayload(msg, "schedule_message", err)
	}
	if strings.TrimSpace(data.ScheduleID) == "" {
		return w.discardInvalidOutboundPayload(
			msg,
			"schedule_message",
			errors.New("schedule_id is required"),
		)
	}
	if strings.TrimSpace(data.Message.MessageID) == "" {
		return w.discardInvalidOutboundPayload(
			msg,
			"schedule_message",
			errors.New("message_id is required"),
		)
	}
	data.ScheduleID = strings.TrimSpace(data.ScheduleID)
	data.Message.MessageID = strings.TrimSpace(data.Message.MessageID)
	w.logOutgoingKafkaDecodedDebug(msg, "schedule_message", data.Message.MessageID, data.Message.ChatID, chatMessageType(data.Message), firstNonEmpty(stringValue(data.Message.Account["id"]), w.cfg.AccountID))
	reference := scheduleMessageAttemptReferenceFor(data)
	claimState, err := w.withScheduleMessageAttempt(
		ctx,
		reference,
		func(attemptCtx context.Context) error {
			return w.handleScheduleSendWithAttempt(attemptCtx, msg, data)
		},
	)
	if err != nil {
		return err
	}
	if claimState != scheduleMessageAttemptAcquired {
		log.Printf(
			"whatsmeow schedule attempt discarded worker_id=%s schedule_id_hash=%s message_id_hash=%s attempt_id_hash=%s claim_state=%s",
			w.cfg.WorkerID,
			hashConnectionFlowIdentifier(reference.ScheduleID),
			hashConnectionFlowIdentifier(reference.MessageID),
			hashConnectionFlowIdentifier(reference.AttemptID),
			claimState,
		)
		if claimState == scheduleMessageAttemptBusy {
			reconciled, reconcileErr := w.reconcileBusyScheduleSend(
				ctx,
				data,
				reference,
			)
			if reconcileErr != nil {
				return reconcileErr
			}
			if reconciled {
				log.Printf(
					"whatsmeow schedule attempt recovered from obsolete provider invocation worker_id=%s schedule_id_hash=%s message_id_hash=%s attempt_id_hash=%s",
					w.cfg.WorkerID,
					hashConnectionFlowIdentifier(reference.ScheduleID),
					hashConnectionFlowIdentifier(reference.MessageID),
					hashConnectionFlowIdentifier(reference.AttemptID),
				)
				return nil
			}
			return restartKafkaGenerationWithoutCommit(fmt.Errorf(
				"schedule message attempt remains active schedule_id_hash=%s message_id_hash=%s attempt_id_hash=%s",
				hashConnectionFlowIdentifier(reference.ScheduleID),
				hashConnectionFlowIdentifier(reference.MessageID),
				hashConnectionFlowIdentifier(reference.AttemptID),
			))
		}
	}
	return nil
}

func (w *Worker) reconcileBusyScheduleSend(
	ctx context.Context,
	data ScheduleMessage,
	reference scheduleMessageAttemptReference,
) (bool, error) {
	assignmentEpoch, err := w.kafkaDispatchAssignmentEpoch(ctx)
	if err != nil {
		return false, err
	}
	if w.whatsapp == nil {
		return false, errWhatsAppRuntimeFenceRevoked
	}
	connectionScope, err := w.whatsapp.captureActiveConnectionScope(ctx)
	if err != nil {
		return false, err
	}
	if err := w.kafkaAndConnectionAuthorization(connectionScope)(ctx); err != nil {
		return false, err
	}
	operation := outboundSendOperation{
		AccountID: w.cfg.AccountID,
		Type:      "schedule",
		ID:        scheduleMessageOutboundOperationID(data),
	}
	takeover, err := w.takeoverScheduleMessageAttemptRecovery(
		ctx,
		reference,
		operation,
		assignmentEpoch,
		connectionScope,
	)
	if err != nil || !takeover.Acquired {
		return false, err
	}
	err = w.withTakenOverScheduleMessageAttempt(
		ctx,
		takeover.Lease,
		func(attemptCtx context.Context) error {
			if err := w.setScheduleMessageOperationalState(
				attemptCtx,
				reference,
				scheduleMessageOperationalAmbiguous,
			); err != nil {
				return err
			}
			return w.publishAndAcknowledgeOutboundRecovery(
				attemptCtx,
				takeover.Claim,
				takeover.Recovery,
			)
		},
	)
	return true, err
}

func (w *Worker) handleScheduleSendWithAttempt(ctx context.Context, msg kafka.Message, data ScheduleMessage) error {
	reference := scheduleMessageAttemptReferenceFor(data)
	reference.AccountID = firstNonEmpty(reference.AccountID, w.cfg.AccountID)
	reference.WorkerID = firstNonEmpty(reference.WorkerID, w.cfg.WorkerID)
	if err := w.assertScheduleMessageAttemptFromContext(ctx); err != nil {
		return err
	}
	if !data.IsValidated {
		w.logOutgoingMessageStepDebug("whatsmeow.outgoing.schedule.ignored", msg, data.Message, map[string]any{
			"schedule_id": data.ScheduleID,
			"contact_id":  data.ContactID,
			"reason":      "not_validated",
		}, nil)
		return w.publishScheduleStatus(ctx, data, "ignored")
	}
	if err := w.waitOutboundReady(ctx, data.Message, msg); err != nil {
		return err
	}
	connectionScope, err := w.whatsapp.captureActiveConnectionScope(ctx)
	if err != nil {
		return err
	}
	fencedCtx := withInboundConnectionScope(ctx, connectionScope)
	authorizeProvider := w.kafkaAndConnectionAuthorization(connectionScope)
	assignmentEpoch, err := w.kafkaDispatchAssignmentEpoch(ctx)
	if err != nil {
		return err
	}
	releaseProviderAdmission, err := w.acquireOutboundProviderAdmission(ctx)
	if err != nil {
		return restartKafkaGenerationWithoutCommit(fmt.Errorf(
			"acquire schedule provider admission: %w",
			err,
		))
	}
	defer releaseProviderAdmission()
	if err := w.assertScheduleMessageAttemptFromContext(ctx); err != nil {
		return restartKafkaGenerationWithoutCommit(fmt.Errorf(
			"revalidate schedule attempt after provider admission: %w",
			err,
		))
	}
	if err := authorizeProvider(ctx); err != nil {
		return restartKafkaGenerationWithoutCommit(fmt.Errorf(
			"revalidate schedule provider authorization after admission: %w",
			err,
		))
	}
	operation := outboundSendOperation{
		AccountID: w.cfg.AccountID,
		Type:      "schedule",
		ID:        scheduleMessageOutboundOperationID(data),
	}
	meta := outboundOperationMeta(msg, operation.AccountID, w.cfg.WorkerID, data.Message.MessageID, data.Message.ChatID)
	meta["schedule_id"] = data.ScheduleID
	meta["attempt_id"] = data.AttemptID
	meta["consumer_assignment_epoch"] = assignmentEpoch
	if err := w.assertScheduleMessageAttemptFromContext(ctx); err != nil {
		return err
	}
	claim, err := w.claimOutboundOperation(ctx, operation, meta)
	if err != nil {
		if errors.Is(err, errOutboundIdempotencyIdentityConflict) {
			log.Printf(
				"whatsmeow schedule immutable identity conflict terminalized worker_id=%s schedule_id_hash=%s message_id_hash=%s error_code=%s",
				w.cfg.WorkerID,
				hashConnectionFlowIdentifier(data.ScheduleID),
				hashConnectionFlowIdentifier(data.Message.MessageID),
				safeOperationalErrorCode(err),
			)
			return w.publishScheduleStatus(fencedCtx, data, "failed")
		}
		return err
	}
	if !claim.Acquired {
		if claim.State == sendIdempotencyStateFailed {
			return w.finalizeScheduleOutboundBusinessRejection(
				fencedCtx,
				data,
				reference,
				claim,
				errors.New("schedule send was rejected before provider invocation"),
			)
		}
		if claim.State == sendIdempotencyStateSucceeded {
			if err := w.setScheduleMessageOperationalState(
				ctx,
				reference,
				scheduleMessageOperationalSucceeded,
			); err != nil {
				return err
			}
			if claim.Recovery != nil {
				if err := w.publishAndAcknowledgeOutboundRecovery(ctx, claim, *claim.Recovery); err != nil {
					if errors.Is(err, errKafkaConsumerDispatchRevoked) ||
						errors.Is(err, errWhatsAppRuntimeFenceRevoked) ||
						errors.Is(err, errOutboundRecoveryObsolete) {
						log.Printf("whatsmeow obsolete durable schedule recovery discarded worker_id=%s schedule_id_hash=%s key_hash=%s error_code=%s", w.cfg.WorkerID, hashConnectionFlowIdentifier(data.ScheduleID), hashConnectionFlowIdentifier(claim.Key), safeOperationalErrorCode(err))
						return nil
					}
					log.Printf("whatsmeow durable schedule recovery remains pending worker_id=%s schedule_id_hash=%s key_hash=%s error_code=%s", w.cfg.WorkerID, hashConnectionFlowIdentifier(data.ScheduleID), hashConnectionFlowIdentifier(claim.Key), safeOperationalErrorCode(err))
				}
				return nil
			}
		}
		if claim.State == sendIdempotencyStateAmbiguous {
			if err := w.setScheduleMessageOperationalState(
				ctx,
				reference,
				scheduleMessageOperationalAmbiguous,
			); err != nil {
				return err
			}
			if claim.Recovery != nil {
				if err := w.publishAndAcknowledgeOutboundRecovery(ctx, claim, *claim.Recovery); err != nil {
					log.Printf(
						"whatsmeow durable ambiguous schedule recovery remains pending worker_id=%s schedule_id_hash=%s key_hash=%s error_code=%s",
						w.cfg.WorkerID,
						hashConnectionFlowIdentifier(data.ScheduleID),
						hashConnectionFlowIdentifier(claim.Key),
						safeOperationalErrorCode(err),
					)
					return err
				}
				return nil
			}
		}
		return w.resolveUnacquiredOutboundClaim(ctx, claim)
	}
	if err := w.prepareOutboundRecovery(ctx, claim); err != nil {
		w.releaseOutboundReservationBestEffort(ctx, claim, true)
		return err
	}
	ambiguousRecovery, err := newOutboundAmbiguousRecovery(
		w.cfg.WorkerID,
		operation.AccountID,
		assignmentEpoch,
		connectionScope,
		data.Message.MessageID,
		data.Message.ChatID,
		ptrScheduleMessageAttemptReference(reference),
	)
	if err != nil {
		w.releaseOutboundReservationBestEffort(ctx, claim, true)
		return err
	}
	fencedCtx = withOutboundProviderStallHandler(
		fencedCtx,
		w.outboundProviderStallTerminalizer(claim, ambiguousRecovery),
	)
	startedAt := time.Now()
	w.logOutgoingMessageStepDebug("whatsmeow.outgoing.schedule.send.invoke", msg, data.Message, map[string]any{
		"schedule_id": data.ScheduleID,
		"contact_id":  data.ContactID,
	}, nil)
	authorizeScheduledProvider := func(authorizeCtx context.Context) error {
		if err := w.assertScheduleMessageAttemptFromContext(authorizeCtx); err != nil {
			return err
		}
		if err := w.whatsapp.assertCapturedConnectionScope(authorizeCtx, connectionScope); err != nil {
			return err
		}
		// Kafka remains the final local authorization so no Redis-backed
		// schedule/runtime lookup widens the dispatch race after it succeeds.
		return w.assertKafkaDispatchAuthorized(authorizeCtx)
	}
	providerInvoked := false
	result, err := w.whatsapp.SendChatMessageWithInvocationBoundary(fencedCtx, data.Message, authorizeProvider, func(boundaryCtx context.Context) error {
		if err := w.markOutboundProviderInvokedWithRecoveryAndDispatchFence(
			boundaryCtx,
			claim,
			&providerInvoked,
			ambiguousRecovery,
			authorizeScheduledProvider,
		); err != nil {
			return err
		}
		providerInvoked = true
		return nil
	})
	releaseProviderAdmission()
	if err != nil {
		if !providerInvoked {
			if isPermanentOutboundPreProviderFailure(err) {
				// Do not release this reservation on a finalization error. Once
				// terminalization starts, a lost Redis response may mean the
				// reserved->failed transition already landed. Redelivery must
				// inspect that ledger state and finish the schedule effects.
				return w.finalizeScheduleOutboundBusinessRejection(
					fencedCtx,
					data,
					reference,
					claim,
					err,
				)
			}
			return w.retryTransientOutboundPreProviderFailure(
				ctx,
				claim,
				true,
				err,
			)
		}
		ambiguousErr := w.persistAndPublishOutboundAmbiguous(
			ctx,
			claim,
			err,
			ambiguousRecovery,
		)
		log.Printf(
			"whatsmeow schedule send failed worker_id=%s account_id=%s topic=%s partition=%d offset=%d schedule_id_hash=%s contact_id_hash=%s message_id_hash=%s chat_id_hash=%s message_type=%s elapsed_ms=%d timeout=%s error_code=%s",
			w.cfg.WorkerID,
			w.cfg.AccountID,
			msg.Topic,
			msg.Partition,
			msg.Offset,
			hashConnectionFlowIdentifier(data.ScheduleID),
			hashConnectionFlowIdentifier(data.ContactID),
			hashConnectionFlowIdentifier(data.Message.MessageID),
			hashConnectionFlowIdentifier(data.Message.ChatID),
			chatMessageType(data.Message),
			time.Since(startedAt).Milliseconds(),
			w.cfg.SendTimeout,
			safeOperationalErrorCode(err),
		)
		w.logOutgoingMessageStepDebug("whatsmeow.outgoing.schedule.send.error", msg, data.Message, map[string]any{
			"schedule_id": data.ScheduleID,
			"contact_id":  data.ContactID,
			"elapsed_ms":  time.Since(startedAt).Milliseconds(),
		}, err)
		if ambiguousErr != nil {
			return ambiguousErr
		}
		// The provider may have accepted the message even though its ACK was
		// lost. Keep the stable message_id operation terminally ambiguous and
		// complete the schedule attempt without publishing a reprocessable
		// failed status. An explicit resend must use a new message_id.
		return nil
	}
	update := UpdateMessage{
		WorkerID:          w.cfg.WorkerID,
		SourceProvider:    "whatsmeow",
		RuntimeGeneration: connectionScope.RuntimeGeneration,
		ConnectionEpoch:   connectionScope.ConnectionEpoch,
		Message:           result,
		Data:              data.Message,
	}
	ensureMessageUpdateEventID(&update)
	updatePublication, err := newOutboundRecoveryPublication(
		topicUpdateMessage,
		outboundUpdateKafkaKey(operation.AccountID, w.cfg.WorkerID, data.Message.MessageID),
		update,
	)
	if err != nil {
		return err
	}
	scheduleStatus := ScheduleStatusUpdate{
		AttemptID:         data.AttemptID,
		AccountID:         operation.AccountID,
		WorkerID:          w.cfg.WorkerID,
		SourceProvider:    "whatsmeow",
		RuntimeGeneration: connectionScope.RuntimeGeneration,
		ConnectionEpoch:   connectionScope.ConnectionEpoch,
		ScheduleID:        data.ScheduleID,
		ContactID:         data.ContactID,
		MessageID:         data.Message.MessageID,
		ProcessedAt:       nowISO(),
		Status:            "sent",
	}
	ensureScheduleStatusEventID(&scheduleStatus)
	statusPublication, err := newOutboundRecoveryPublication(
		topicScheduleStatusUpdate,
		scheduleStatusKafkaKey(data.ScheduleID, data.ContactID, data.Message.MessageID),
		scheduleStatus,
	)
	if err != nil {
		return err
	}
	recovery := outboundRecoveryRecord{
		SchemaVersion:           outboundRecoverySchemaVersion,
		WorkerID:                w.cfg.WorkerID,
		AccountID:               operation.AccountID,
		ConsumerAssignmentEpoch: assignmentEpoch,
		OriginRuntimeGeneration: connectionScope.RuntimeGeneration,
		OriginConnectionEpoch:   connectionScope.ConnectionEpoch,
		ScheduleAttempt:         ptrScheduleMessageAttemptReference(reference),
		Publications:            []outboundRecoveryPublication{updatePublication, statusPublication},
	}
	if err := persistOutboundProviderOutcome(ctx, func(attemptCtx context.Context) error {
		return w.completeOutboundSuccessWithRecovery(attemptCtx, claim, map[string]any{"update_message": update}, recovery)
	}); err != nil {
		return err
	}
	if err := w.setScheduleMessageOperationalState(
		ctx,
		reference,
		scheduleMessageOperationalSucceeded,
	); err != nil {
		return err
	}
	w.logOutgoingMessageStepDebug("whatsmeow.outgoing.schedule.send.success", msg, data.Message, map[string]any{
		"schedule_id":          data.ScheduleID,
		"contact_id":           data.ContactID,
		"elapsed_ms":           time.Since(startedAt).Milliseconds(),
		"external_message_id":  messageKeyFromSendResult(result),
		"schedule_status_next": "sent",
	}, nil)
	if err := w.publishAndAcknowledgeOutboundRecovery(ctx, claim, recovery); err != nil {
		log.Printf("whatsmeow schedule update publish failed worker_id=%s account_id=%s source_topic=%s partition=%d offset=%d schedule_id_hash=%s message_id_hash=%s topic=%s error_code=%s", w.cfg.WorkerID, w.cfg.AccountID, msg.Topic, msg.Partition, msg.Offset, hashConnectionFlowIdentifier(data.ScheduleID), hashConnectionFlowIdentifier(data.Message.MessageID), topicUpdateMessage, safeOperationalErrorCode(err))
		w.logOutgoingMessageStepDebug("whatsmeow.outgoing.schedule.update.publish.error", msg, data.Message, map[string]any{
			"schedule_id": data.ScheduleID,
			"contact_id":  data.ContactID,
			"topic":       topicUpdateMessage,
		}, err)
		return nil
	}
	w.logOutgoingMessageStepDebug("whatsmeow.outgoing.schedule.update.publish.success", msg, data.Message, map[string]any{
		"schedule_id": data.ScheduleID,
		"contact_id":  data.ContactID,
		"topic":       topicUpdateMessage,
	}, nil)
	return nil
}

func (w *Worker) finalizeScheduleOutboundBusinessRejection(
	ctx context.Context,
	data ScheduleMessage,
	reference scheduleMessageAttemptReference,
	claim outboundSendClaim,
	cause error,
) error {
	if cause == nil {
		cause = errors.New("schedule send was rejected before provider invocation")
	}
	if !isPermanentOutboundPreProviderFailure(cause) &&
		!(claim.State == sendIdempotencyStateFailed && !claim.Acquired) {
		return fmt.Errorf("schedule permanent failure finalization requires a definitive payload/target outcome: %w", cause)
	}
	persist := func() error {
		return runScheduleOutboundBusinessRejectionFinalization(
			func() error {
				return w.removeOutboundRecoveryIndex(ctx, claim.Key)
			},
			func() error {
				if claim.Acquired {
					return w.completeOutboundPreProviderFailure(ctx, claim, cause)
				}
				if claim.State != sendIdempotencyStateFailed {
					return fmt.Errorf(
						"schedule business rejection has unexpected outbound claim state %q",
						claim.State,
					)
				}
				return nil
			},
			func() error {
				return w.setScheduleMessageOperationalState(
					ctx,
					reference,
					scheduleMessageOperationalPreProviderFailed,
				)
			},
			func() error {
				return w.publishScheduleStatus(ctx, data, "failed")
			},
		)
	}
	if claim.Acquired {
		return terminalizePermanentOutboundPreProviderFailure(cause, persist)
	}
	if err := persist(); err != nil {
		return errors.Join(cause, err)
	}
	if claim.State != sendIdempotencyStateFailed {
		return fmt.Errorf(
			"schedule business rejection has unexpected outbound claim state %q",
			claim.State,
		)
	}
	return terminalKafkaHandlerError(cause)
}

func runScheduleOutboundBusinessRejectionFinalization(
	removePreparedRecovery func() error,
	terminalizeClaim func() error,
	persistOperationalState func() error,
	publishFailedStatus func() error,
) error {
	// Cleanup precedes the terminal ledger write so an uncertain cleanup cannot
	// strand a failed ledger with a live provider-recovery entry. After the
	// reserved->failed transition, every remaining step is replayable without
	// making the WhatsApp provider call again. Operational state is persisted
	// before its corresponding externally consumed status event.
	steps := []struct {
		name string
		run  func() error
	}{
		{name: "remove prepared outbound recovery", run: removePreparedRecovery},
		{name: "terminalize outbound claim", run: terminalizeClaim},
		{name: "persist pre-provider failed operational state", run: persistOperationalState},
		{name: "publish failed schedule status", run: publishFailedStatus},
	}
	for _, step := range steps {
		if step.run == nil {
			return fmt.Errorf("%s callback is required", step.name)
		}
		if err := step.run(); err != nil {
			return fmt.Errorf("%s: %w", step.name, err)
		}
	}
	return nil
}

func (w *Worker) handlePhoneValidation(ctx context.Context, msg kafka.Message) error {
	var req PhoneValidationRequest
	if err := json.Unmarshal(msg.Value, &req); err != nil {
		return nil
	}
	connectionScope, err := w.whatsapp.captureActiveConnectionScope(ctx)
	if err != nil {
		return err
	}
	authorizeProvider := w.kafkaAndConnectionAuthorization(connectionScope)
	fencedCtx := withInboundConnectionScope(ctx, connectionScope)
	resp, err := w.whatsapp.ValidatePhoneWithAuthorization(fencedCtx, req, authorizeProvider)
	if err != nil {
		// Do not publish a provider outage as a definitive invalid phone. Keep
		// the Kafka offset uncommitted so bounded retries/redelivery can obtain
		// a real validation result after the provider recovers.
		return fmt.Errorf("phone validation provider failed: %w", err)
	}
	resp.SourceProvider = connectionScope.SourceProvider
	resp.RuntimeGeneration = connectionScope.RuntimeGeneration
	resp.ConnectionEpoch = connectionScope.ConnectionEpoch
	if err := w.runKafkaRepublishWithConnectionAuthorization(fencedCtx, connectionScope, func(publishCtx context.Context) error {
		return w.kafka.SendJSON(publishCtx, topicPhoneValidationResponse, resp.RequestID, resp)
	}); err != nil {
		return err
	}
	if !resp.Valid {
		return terminalKafkaHandlerError(errors.New("phone validation completed with a definitive negative result"))
	}
	return nil
}

func (w *Worker) handleNotification(ctx context.Context, msg kafka.Message) error {
	var data NotificationMessage
	if err := json.Unmarshal(msg.Value, &data); err != nil {
		logKafkaPayloadDecodeError(w.cfg.WorkerID, msg, err)
		return nil
	}
	if err := w.validateOutboundPayloadIdentity(
		"notification_message",
		[]string{stringValue(data.Account["id"])},
		[]string{stringValue(data.Worker["id"])},
	); err != nil {
		return w.discardInvalidOutboundPayload(msg, "notification_message", err)
	}
	if strings.TrimSpace(data.MessageWhatsApp) == "" {
		return nil
	}
	accountID := w.cfg.AccountID
	operationID := outboundOperationIDFromMessage(msg, notificationOperationID(data))
	if operationID == "" {
		return w.discardInvalidOutboundPayload(
			msg,
			"notification_message",
			errors.New("operation_id or legacy notification destination identity is required"),
		)
	}
	data.OperationID = operationID
	notificationIdentity := firstNonEmpty(
		strings.TrimSpace(data.NotificationID),
		strings.TrimSpace(data.ID),
		strings.TrimSpace(data.OperationID),
	)
	if notificationIdentity == "" {
		return w.discardInvalidOutboundPayload(
			msg,
			"notification_message",
			errors.New("notification message_id identity is required"),
		)
	}
	notificationMessageID := "notification_" + notificationIdentity
	operation := outboundSendOperation{
		AccountID: accountID,
		Type:      "notification",
		ID:        operationID,
	}
	connectionScope, err := w.whatsapp.captureActiveConnectionScope(ctx)
	if err != nil {
		return err
	}
	authorizeProvider := w.kafkaAndConnectionAuthorization(connectionScope)
	fencedCtx := withInboundConnectionScope(ctx, connectionScope)
	target := data.MessageKey.RemoteJID
	if target == "" {
		resp, err := w.whatsapp.ValidatePhoneWithAuthorization(fencedCtx, PhoneValidationRequest{
			AccountID: w.cfg.AccountID,
			WorkerID:  w.cfg.WorkerID,
			Phone:     data.MessageKey.PhoneNumber,
			PhoneDDI:  data.MessageKey.PhoneDDI,
		}, authorizeProvider)
		if err != nil || !resp.Valid || resp.JID == "" {
			return validationError(err, resp)
		}
		target = resp.JID
		if strings.TrimSpace(data.UserID) != "" {
			jidUpdate := buildUserPhoneJIDUpdate(
				data,
				accountID,
				target,
				connectionScope,
			)
			jidUpdateKey := userPhoneJIDUpdateKafkaKey(jidUpdate)
			if jidUpdate.EventID == "" || jidUpdateKey == "" {
				return errors.New("notification JID update is missing a stable operational identity")
			}
			if err := publishNotificationJIDUpdateBeforeProvider(fencedCtx, func(publishCtx context.Context) error {
				return w.runKafkaRepublishWithConnectionAuthorization(publishCtx, connectionScope, func(authorizedCtx context.Context) error {
					return w.kafka.SendJSON(
						authorizedCtx,
						topicUserPhoneJIDUpdate,
						jidUpdateKey,
						jidUpdate,
					)
				})
			}); err != nil {
				return err
			}
		}
	}
	notificationMessage := ChatMessage{
		MessageID: notificationMessageID,
		MessageKey: &MessageKey{
			RemoteJID: target,
		},
		Account: map[string]any{"id": accountID},
		Worker:  map[string]any{"id": w.cfg.WorkerID},
		Content: map[string]any{
			"type":    MessageTypeText,
			"message": data.MessageWhatsApp,
		},
	}
	if err := w.waitOutboundReady(ctx, notificationMessage, msg); err != nil {
		return err
	}
	meta := outboundOperationMeta(msg, operation.AccountID, w.cfg.WorkerID, notificationMessage.MessageID, target)
	meta["notification_id"] = data.NotificationID
	meta["operation_id"] = operationID
	assignmentEpoch, err := w.kafkaDispatchAssignmentEpoch(ctx)
	if err != nil {
		return err
	}
	releaseProviderAdmission, err := w.acquireOutboundProviderAdmission(ctx)
	if err != nil {
		return restartKafkaGenerationWithoutCommit(fmt.Errorf(
			"acquire notification provider admission: %w",
			err,
		))
	}
	defer releaseProviderAdmission()
	if err := authorizeProvider(ctx); err != nil {
		return restartKafkaGenerationWithoutCommit(fmt.Errorf(
			"revalidate notification provider authorization after admission: %w",
			err,
		))
	}
	meta["consumer_assignment_epoch"] = assignmentEpoch
	claim, err := w.claimOutboundOperation(fencedCtx, operation, meta)
	if err != nil {
		if errors.Is(err, errOutboundIdempotencyIdentityConflict) {
			log.Printf(
				"whatsmeow notification immutable identity conflict discarded worker_id=%s notification_id_hash=%s operation_id_hash=%s error_code=%s",
				w.cfg.WorkerID,
				hashConnectionFlowIdentifier(data.NotificationID),
				hashConnectionFlowIdentifier(operation.ID),
				safeOperationalErrorCode(err),
			)
			return nil
		}
		return err
	}
	if !claim.Acquired {
		if (claim.State == sendIdempotencyStateSucceeded ||
			claim.State == sendIdempotencyStateFailed ||
			claim.State == sendIdempotencyStateAmbiguous) &&
			claim.Recovery != nil {
			if err := w.publishAndAcknowledgeOutboundRecovery(ctx, claim, *claim.Recovery); err != nil {
				log.Printf(
					"whatsmeow durable notification recovery remains pending worker_id=%s notification_id_hash=%s key_hash=%s error_code=%s",
					w.cfg.WorkerID,
					hashConnectionFlowIdentifier(data.NotificationID),
					hashConnectionFlowIdentifier(claim.Key),
					safeOperationalErrorCode(err),
				)
				if claim.State == sendIdempotencyStateAmbiguous {
					return err
				}
			}
			return nil
		}
		return w.resolveUnacquiredOutboundClaim(ctx, claim)
	}
	if err := w.prepareOutboundRecovery(ctx, claim); err != nil {
		w.releaseOutboundReservationBestEffort(ctx, claim, true)
		return err
	}
	ambiguousRecovery, err := newNotificationAmbiguousRecovery(
		w.cfg.WorkerID,
		accountID,
		assignmentEpoch,
		connectionScope,
	)
	if err != nil {
		w.releaseOutboundReservationBestEffort(ctx, claim, true)
		return err
	}
	fencedCtx = withOutboundProviderStallHandler(
		fencedCtx,
		w.outboundProviderStallTerminalizer(claim, ambiguousRecovery),
	)
	startedAt := time.Now()
	providerInvoked := false
	_, err = w.whatsapp.SendChatMessageWithInvocationBoundary(fencedCtx, notificationMessage, authorizeProvider, func(boundaryCtx context.Context) error {
		if err := w.markOutboundProviderInvokedWithRecoveryAndDispatchFence(
			boundaryCtx,
			claim,
			&providerInvoked,
			ambiguousRecovery,
			authorizeProvider,
		); err != nil {
			return err
		}
		providerInvoked = true
		return nil
	})
	releaseProviderAdmission()
	if err != nil {
		if !providerInvoked {
			if isPermanentOutboundPreProviderFailure(err) {
				terminalErr := terminalizePermanentOutboundPreProviderFailure(err, func() error {
					return w.completeOutboundPreProviderFailure(ctx, claim, err)
				})
				if !shouldCommitTerminalKafkaHandlerError(terminalErr) {
					w.releaseOutboundReservationBestEffort(ctx, claim, true)
				}
				return terminalErr
			}
			return w.retryTransientOutboundPreProviderFailure(
				ctx,
				claim,
				true,
				err,
			)
		}
		ambiguousErr := w.persistAndPublishOutboundAmbiguous(
			ctx,
			claim,
			err,
			ambiguousRecovery,
		)
		log.Printf(
			"whatsmeow notification send failed worker_id=%s topic=%s partition=%d offset=%d notification_id_hash=%s message_id_hash=%s elapsed_ms=%d timeout=%s error_code=%s",
			w.cfg.WorkerID,
			msg.Topic,
			msg.Partition,
			msg.Offset,
			hashConnectionFlowIdentifier(data.NotificationID),
			hashConnectionFlowIdentifier(notificationMessage.MessageID),
			time.Since(startedAt).Milliseconds(),
			w.cfg.SendTimeout,
			safeOperationalErrorCode(err),
		)
		return ambiguousErr
	}
	if err := persistOutboundProviderOutcome(ctx, func(attemptCtx context.Context) error {
		return w.completeOutboundSuccess(attemptCtx, claim, map[string]any{})
	}); err != nil {
		return err
	}
	if err := w.removeOutboundRecoveryIndex(ctx, claim.Key); err != nil {
		log.Printf(
			"whatsmeow notification recovery index cleanup deferred worker_id=%s key_hash=%s error_code=%s",
			w.cfg.WorkerID,
			hashConnectionFlowIdentifier(claim.Key),
			safeOperationalErrorCode(err),
		)
	}
	return nil
}

func publishNotificationJIDUpdateBeforeProvider(
	ctx context.Context,
	publish func(context.Context) error,
) error {
	if publish == nil {
		return restartKafkaGenerationWithoutCommit(
			errors.New("notification JID update publisher is unavailable"),
		)
	}
	if err := publish(ctx); err != nil {
		return restartKafkaGenerationWithoutCommit(fmt.Errorf(
			"publish notification JID update before provider invocation: %w",
			err,
		))
	}
	return nil
}

func (w *Worker) handleWebhookIntegration(ctx context.Context, msg kafka.Message) error {
	var data map[string]any
	if err := json.Unmarshal(msg.Value, &data); err != nil {
		return nil
	}
	accountID := firstNonEmpty(stringValue(data["account_id"]), w.cfg.AccountID)
	workerID := stringValue(data["worker_id"])
	if workerID != "" && workerID != w.cfg.WorkerID {
		return nil
	}
	entitlementRevision := stringValue(data["integration_entitlement_revision"])
	eventID := firstNonEmpty(
		stringValue(data["event_id"]),
		stringValue(data["webhook_id"]),
		stringValue(data["request_id"]),
		string(msg.Key),
		fmt.Sprintf("%s:%d:%d", msg.Topic, msg.Partition, msg.Offset),
	)
	entitled, _, err := w.hasCurrentIntegrationEntitlement(ctx, accountID, entitlementRevision, "received", eventID)
	if err != nil {
		return terminalKafkaHandlerError(wrapSafeOperationalError(safeCodeWebhookIntegrationUnavailable, err))
	}
	if !entitled {
		return nil
	}
	mapped := asMap(data["mapped_data"])
	messageText := stringValue(mapped["message"])
	if stringValue(mapped["message_type"]) == "chatbot" {
		if mappingMessage := stringValue(asMap(data["mapping"])["message"]); mappingMessage != "" {
			if value := nestedString(asMap(data["body"]), mappingMessage); value != "" {
				messageText = value
			}
		}
	}
	if messageText == "" {
		return nil
	}

	connectionScope, err := w.whatsapp.captureActiveConnectionScope(ctx)
	if err != nil {
		return err
	}
	authorizeProvider := w.kafkaAndConnectionAuthorization(connectionScope)
	fencedCtx := withInboundConnectionScope(ctx, connectionScope)
	resp, err := w.whatsapp.ValidatePhoneWithAuthorization(fencedCtx, PhoneValidationRequest{
		AccountID: accountID,
		WorkerID:  w.cfg.WorkerID,
		Phone:     stringValue(data["phone"]),
		PhoneDDI:  stringValue(data["phone_ddi"]),
	}, authorizeProvider)
	if err != nil || !resp.Valid || resp.JID == "" {
		return validationError(err, resp)
	}

	upsert := UpsertMessage{
		IntegrationEntitlementRevision: entitlementRevision,
		EventID:                        eventID,
		AccountID:                      accountID,
		WorkerID:                       w.cfg.WorkerID,
		SourceProvider:                 "webhook",
		Type:                           MessageTypeText,
		Message: map[string]any{
			"key": map[string]any{
				"remoteJid": resp.JID,
				"fromMe":    false,
				"id":        "webhook_" + randomHex(12),
			},
			"messageTimestamp": time.Now().Unix(),
			"message":          map[string]any{"conversation": messageText},
		},
		HasQuoted: false,
	}
	if value := stringValue(mapped["message_type"]); value == "message" || value == "chatbot" {
		upsert.WebhookMessageType = value
	}
	upsert.WebhookChatbotID = stringValue(mapped["chatbot_id"])
	upsert.TransferSectorID = stringValue(mapped["transfer_sector_id"])
	upsert.TransferSectorUserID = stringValue(mapped["transfer_sector_user_id"])
	upsert.TransferUserID = stringValue(mapped["transfer_user_id"])
	entitled, entitlementSource, err := w.hasCurrentIntegrationEntitlement(fencedCtx, accountID, entitlementRevision, "publish", eventID)
	if err != nil {
		return terminalKafkaHandlerError(wrapSafeOperationalError(safeCodeWebhookIntegrationUnavailable, err))
	}
	if !entitled {
		return nil
	}
	ensureInboundEventIdentity(&upsert, "webhook_integration")
	messageID := stringValue(asMap(upsert.Message["key"])["id"])
	log.Printf(
		"plan_entitlement_audit surface=inbound_worker outcome=allowed account_id=%s plan_product_id=%s revision=%s source=%s event_id=%s topic=%s partition=%d offset=%d",
		accountID,
		integrationPlanProductID,
		entitlementRevision,
		entitlementSource,
		messageID,
		msg.Topic,
		msg.Partition,
		msg.Offset,
	)
	kafkaKey := incomingUpsertKafkaKey(w.cfg, &upsert)
	err = w.runKafkaRepublishWithConnectionAuthorization(fencedCtx, connectionScope, func(publishCtx context.Context) error {
		return w.kafka.SendJSON(publishCtx, topicUpsertMessage, kafkaKey, upsert)
	})
	if err != nil {
		return err
	}
	return nil
}

func (w *Worker) handleMarkRead(ctx context.Context, msg kafka.Message) error {
	var data MarkReadRequest
	if err := json.Unmarshal(msg.Value, &data); err != nil {
		return nil
	}
	if data.WorkerID != w.cfg.WorkerID {
		return nil
	}
	if w.redis == nil {
		return errors.New("mark-read Redis client is not configured")
	}
	enabled, err := w.redis.Get(ctx, "worker:"+w.cfg.WorkerID+":mark_as_read").Result()
	if err != nil && !errors.Is(err, redis.Nil) {
		return fmt.Errorf("load mark-read configuration: %w", err)
	}
	if errors.Is(err, redis.Nil) || enabled != "true" {
		return nil
	}
	connectionScope, err := w.whatsapp.captureActiveConnectionScope(ctx)
	if err != nil {
		return err
	}
	fencedCtx := withInboundConnectionScope(ctx, connectionScope)
	authorizeProvider := w.kafkaAndConnectionAuthorization(connectionScope)
	fencedCtx = withProviderAuthorizationGuard(fencedCtx, authorizeProvider)
	fencedCtx = withProviderInvocationTimeout(fencedCtx, w.cfg.SendTimeout)
	fencedCtx = w.whatsapp.withAuxiliaryProviderInvocationWatchdog(
		fencedCtx,
		fmt.Sprintf(
			"mark_read:%s:%d:%d",
			msg.Topic,
			msg.Partition,
			msg.Offset,
		),
	)
	client := w.whatsapp.getClient()
	if client == nil {
		return errors.New("mark-read WhatsApp client is not ready")
	}
	for _, key := range data.Keys {
		chat, err := parseJID(key.Remote())
		if err != nil || key.ID == "" {
			continue
		}
		sender := senderJIDFromKey(chat, &key)
		readAt := time.Now()
		if err := invokeProviderAuthorizedErrorCall(fencedCtx, authorizeProvider, func(invokeCtx context.Context) error {
			return client.MarkRead(invokeCtx, []types.MessageID{key.ID}, readAt, chat, sender)
		}); err != nil {
			return fmt.Errorf("mark message as read id=%s: %w", key.ID, err)
		}
		if err := authorizeProvider(fencedCtx); err != nil {
			return err
		}
		w.whatsapp.markChatAsReadAppState(fencedCtx, client, key, chat, readAt)
		if err := authorizeProvider(fencedCtx); err != nil {
			return err
		}
		update := MessageStatusUpdate{
			AccountID:         data.AccountID,
			WorkerID:          w.cfg.WorkerID,
			SourceProvider:    "whatsmeow",
			RuntimeGeneration: connectionScope.RuntimeGeneration,
			ConnectionEpoch:   connectionScope.ConnectionEpoch,
			MessageID:         key.ID,
			Patch:             map[string]any{"is_seen": true},
			Key:               waKeyMap(key),
		}
		ensureMessageStatusEventID(&update)
		if err := w.runKafkaRepublishWithConnectionAuthorization(fencedCtx, connectionScope, func(publishCtx context.Context) error {
			return w.kafka.SendJSON(
				publishCtx,
				topicUpdateMessageStatus,
				messageStatusKafkaKey(data.AccountID, w.cfg.WorkerID, key.ID),
				update,
			)
		}); err != nil {
			return err
		}
	}
	return nil
}

func (w *Worker) handleWorkerConfigUpdate(ctx context.Context, msg kafka.Message) error {
	var data WorkerConfigUpdateEvent
	if err := json.Unmarshal(msg.Value, &data); err != nil {
		return nil
	}
	if data.WorkerID != w.cfg.WorkerID || data.RejectCall == nil {
		return nil
	}
	w.kafkaDispatchMu.RLock()
	defer w.kafkaDispatchMu.RUnlock()
	if err := w.assertKafkaDispatchAuthorized(ctx); err != nil {
		return err
	}
	current, err := w.validateCurrentWorkerConfigRevision(
		ctx,
		data.WorkerID,
		data.Revision,
	)
	if err != nil {
		return err
	}
	if !current {
		return nil
	}
	if err := w.assertKafkaDispatchAuthorized(ctx); err != nil {
		return err
	}
	w.whatsapp.setRejectCalls(*data.RejectCall)
	return nil
}

type sendFailureLogContext struct {
	Topic        string
	Partition    int
	Offset       int64
	MessageType  string
	Elapsed      time.Duration
	SendTimeout  time.Duration
	HandlerScope string
}

func (w *Worker) publishDirectIdentityConflictStatus(
	ctx context.Context,
	connectionScope whatsAppRuntimeFence,
	data ChatMessage,
	cause error,
) error {
	messageID := strings.TrimSpace(data.MessageID)
	accountID := firstNonEmpty(stringValue(data.Account["id"]), w.cfg.AccountID)
	if messageID == "" || strings.TrimSpace(accountID) == "" {
		return fmt.Errorf("invalid immutable identity conflict payload: %w", cause)
	}
	update := newMessageNotSentStatusUpdate(
		w.cfg.WorkerID,
		accountID,
		connectionScope,
		messageID,
		data.ChatID,
	)
	log.Printf(
		"whatsmeow direct immutable identity conflict terminalized worker_id=%s account_id=%s message_id_hash=%s chat_id_hash=%s error_code=%s",
		w.cfg.WorkerID,
		accountID,
		hashConnectionFlowIdentifier(messageID),
		hashConnectionFlowIdentifier(data.ChatID),
		safeOperationalErrorCode(cause),
	)
	return retryOutboundPostProviderSideEffect(ctx, func(attemptCtx context.Context) error {
		return w.runKafkaRepublishWithConnectionAuthorization(
			attemptCtx,
			connectionScope,
			func(publishCtx context.Context) error {
				return w.kafka.SendJSON(
					publishCtx,
					topicUpdateMessageStatus,
					messageStatusKafkaKey(accountID, w.cfg.WorkerID, messageID),
					update,
				)
			},
		)
	})
}

func (w *Worker) terminalizeDirectPreProviderFailure(
	ctx context.Context,
	claim outboundSendClaim,
	assignmentEpoch uint64,
	connectionScope whatsAppRuntimeFence,
	data ChatMessage,
	cause error,
	detail sendFailureLogContext,
) error {
	messageID := strings.TrimSpace(data.MessageID)
	accountID := firstNonEmpty(stringValue(data.Account["id"]), w.cfg.AccountID)
	log.Printf(
		"whatsmeow send terminal failure worker_id=%s scope=%s topic=%s partition=%d offset=%d message_id_hash=%s chat_id_hash=%s account_id=%s message_type=%s elapsed_ms=%d timeout=%s error_code=%s",
		w.cfg.WorkerID,
		detail.HandlerScope,
		detail.Topic,
		detail.Partition,
		detail.Offset,
		hashConnectionFlowIdentifier(messageID),
		hashConnectionFlowIdentifier(data.ChatID),
		accountID,
		detail.MessageType,
		detail.Elapsed.Milliseconds(),
		detail.SendTimeout,
		safeOperationalErrorCode(cause),
	)

	ledgerCtx, cancel := context.WithTimeout(
		context.WithoutCancel(ctx),
		outboundAuthorizationFenceTimeout,
	)
	defer cancel()

	if messageID == "" {
		if err := retryOutboundPostProviderSideEffect(ledgerCtx, func(attemptCtx context.Context) error {
			return w.completeOutboundPreProviderFailure(attemptCtx, claim, cause)
		}); err != nil {
			return err
		}
		if err := w.removeOutboundRecoveryIndex(ledgerCtx, claim.Key); err != nil {
			log.Printf("whatsmeow empty-message failed recovery cleanup deferred worker_id=%s key_hash=%s error_code=%s", w.cfg.WorkerID, hashConnectionFlowIdentifier(claim.Key), safeOperationalErrorCode(err))
		}
		return nil
	}

	update := newMessageNotSentStatusUpdate(
		w.cfg.WorkerID,
		accountID,
		connectionScope,
		messageID,
		data.ChatID,
	)
	publication, err := newOutboundRecoveryPublication(
		topicUpdateMessageStatus,
		messageStatusKafkaKey(accountID, w.cfg.WorkerID, messageID),
		update,
	)
	if err != nil {
		return err
	}
	recovery := outboundRecoveryRecord{
		SchemaVersion:           outboundRecoverySchemaVersion,
		WorkerID:                w.cfg.WorkerID,
		AccountID:               accountID,
		ConsumerAssignmentEpoch: assignmentEpoch,
		OriginRuntimeGeneration: connectionScope.RuntimeGeneration,
		OriginConnectionEpoch:   connectionScope.ConnectionEpoch,
		Publications:            []outboundRecoveryPublication{publication},
	}
	// The source handler context may already be canceled. Persist the terminal
	// reserved->failed ledger and exact status payload under a short detached
	// budget; after this point Kafka can commit and only the replayable status
	// publication remains. The recovery loop cannot invoke WhatsApp.
	return retryOutboundPostProviderSideEffect(ledgerCtx, func(attemptCtx context.Context) error {
		return w.completeOutboundPreProviderFailureWithRecovery(
			attemptCtx,
			claim,
			cause,
			recovery,
		)
	})
}

func newMessageNotSentStatusUpdate(
	workerID string,
	accountID string,
	connectionScope whatsAppRuntimeFence,
	messageID string,
	chatID string,
) MessageStatusUpdate {
	update := MessageStatusUpdate{
		AccountID:             accountID,
		WorkerID:              workerID,
		SourceProvider:        "whatsmeow",
		RuntimeGeneration:     connectionScope.RuntimeGeneration,
		ConnectionEpoch:       connectionScope.ConnectionEpoch,
		MessageID:             messageID,
		InternalMessageID:     messageID,
		TerminalFailureSchema: messageSendTerminalFailureRecoverySchema,
		Patch:                 map[string]any{},
		Failed:                true,
		Key: map[string]any{
			"id":     messageID,
			"fromMe": true,
		},
	}
	if strings.TrimSpace(chatID) != "" {
		update.Key["remoteJid"] = chatID
	}
	ensureMessageStatusEventID(&update)
	return update
}

func newMessageAmbiguousStatusUpdate(
	workerID string,
	accountID string,
	connectionScope whatsAppRuntimeFence,
	messageID string,
	chatID string,
) MessageStatusUpdate {
	update := MessageStatusUpdate{
		AccountID:             strings.TrimSpace(accountID),
		WorkerID:              strings.TrimSpace(workerID),
		SourceProvider:        "whatsmeow",
		RuntimeGeneration:     connectionScope.RuntimeGeneration,
		ConnectionEpoch:       strings.TrimSpace(connectionScope.ConnectionEpoch),
		MessageID:             strings.TrimSpace(messageID),
		InternalMessageID:     strings.TrimSpace(messageID),
		TerminalFailureSchema: messageSendAmbiguousTerminalSchema,
		Patch:                 map[string]any{},
		Failed:                true,
		Ambiguous:             true,
		Key: map[string]any{
			"id":     strings.TrimSpace(messageID),
			"fromMe": true,
		},
	}
	if strings.TrimSpace(chatID) != "" {
		update.Key["remoteJid"] = strings.TrimSpace(chatID)
	}
	ensureMessageStatusEventID(&update)
	return update
}

func newOutboundAmbiguousRecovery(
	workerID string,
	accountID string,
	assignmentEpoch uint64,
	connectionScope whatsAppRuntimeFence,
	messageID string,
	chatID string,
	scheduleAttempt *scheduleMessageAttemptReference,
) (outboundRecoveryRecord, error) {
	update := newMessageAmbiguousStatusUpdate(
		workerID,
		accountID,
		connectionScope,
		messageID,
		chatID,
	)
	if update.EventID == "" ||
		update.MessageID == "" ||
		update.InternalMessageID != update.MessageID {
		return outboundRecoveryRecord{}, errors.New("ambiguous message status is missing a stable message identity")
	}
	publication, err := newOutboundRecoveryPublication(
		topicUpdateMessageStatus,
		messageStatusKafkaKey(accountID, workerID, messageID),
		update,
	)
	if err != nil {
		return outboundRecoveryRecord{}, err
	}
	recovery := outboundRecoveryRecord{
		SchemaVersion:           outboundRecoverySchemaVersion,
		WorkerID:                strings.TrimSpace(workerID),
		AccountID:               strings.TrimSpace(accountID),
		ConsumerAssignmentEpoch: assignmentEpoch,
		OriginRuntimeGeneration: connectionScope.RuntimeGeneration,
		OriginConnectionEpoch:   strings.TrimSpace(connectionScope.ConnectionEpoch),
		ScheduleAttempt:         scheduleAttempt,
		Publications:            []outboundRecoveryPublication{publication},
	}
	if err := validateOutboundRecoveryRecord(recovery); err != nil {
		return outboundRecoveryRecord{}, err
	}
	return recovery, nil
}

func newNotificationAmbiguousRecovery(
	workerID string,
	accountID string,
	assignmentEpoch uint64,
	connectionScope whatsAppRuntimeFence,
) (outboundRecoveryRecord, error) {
	recovery := outboundRecoveryRecord{
		SchemaVersion:           outboundRecoverySchemaVersion,
		WorkerID:                strings.TrimSpace(workerID),
		AccountID:               strings.TrimSpace(accountID),
		ConsumerAssignmentEpoch: assignmentEpoch,
		OriginRuntimeGeneration: connectionScope.RuntimeGeneration,
		OriginConnectionEpoch:   strings.TrimSpace(connectionScope.ConnectionEpoch),
		TargetKind:              outboundRecoveryTargetNotification,
		Publications:            []outboundRecoveryPublication{},
	}
	if err := validateOutboundRecoveryRecord(recovery); err != nil {
		return outboundRecoveryRecord{}, err
	}
	return recovery, nil
}

func (w *Worker) persistAndPublishOutboundAmbiguous(
	ctx context.Context,
	claim outboundSendClaim,
	cause error,
	recovery outboundRecoveryRecord,
) error {
	ledgerCtx, cancel := context.WithTimeout(
		context.WithoutCancel(ctx),
		outboundRecoveryAttemptTimeout,
	)
	defer cancel()
	if err := retryOutboundPostProviderSideEffect(ledgerCtx, func(attemptCtx context.Context) error {
		return w.completeOutboundAmbiguousWithRecovery(
			attemptCtx,
			claim,
			cause,
			recovery,
		)
	}); err != nil {
		return err
	}
	if err := w.publishAndAcknowledgeOutboundRecovery(ledgerCtx, claim, recovery); err != nil {
		// The exact terminal recovery is already in the ledger and queue. The
		// recovery publisher will retry it without ever calling WhatsApp.
		log.Printf(
			"whatsmeow ambiguous terminal status remains pending worker_id=%s key_hash=%s error_code=%s",
			w.cfg.WorkerID,
			hashConnectionFlowIdentifier(claim.Key),
			safeOperationalErrorCode(err),
		)
		return err
	}
	return nil
}

func (w *Worker) outboundProviderStallTerminalizer(
	claim outboundSendClaim,
	recovery outboundRecoveryRecord,
) outboundProviderStallHandler {
	return func(ctx context.Context, cause error) error {
		return retryOutboundPostProviderSideEffect(
			ctx,
			func(attemptCtx context.Context) error {
				return w.completeOutboundAmbiguousWithRecovery(
					attemptCtx,
					claim,
					cause,
					recovery,
				)
			},
		)
	}
}

func (w *Worker) markSendAsNotSent(ctx context.Context, messageID, chatID, accountID string, sendErr error, details ...sendFailureLogContext) error {
	messageID = strings.TrimSpace(messageID)
	accountID = firstNonEmpty(accountID, w.cfg.AccountID)
	if len(details) > 0 {
		detail := details[0]
		log.Printf(
			"whatsmeow send terminal failure worker_id=%s scope=%s topic=%s partition=%d offset=%d message_id_hash=%s chat_id_hash=%s account_id=%s message_type=%s elapsed_ms=%d timeout=%s error_code=%s",
			w.cfg.WorkerID,
			detail.HandlerScope,
			detail.Topic,
			detail.Partition,
			detail.Offset,
			hashConnectionFlowIdentifier(messageID),
			hashConnectionFlowIdentifier(chatID),
			accountID,
			detail.MessageType,
			detail.Elapsed.Milliseconds(),
			detail.SendTimeout,
			safeOperationalErrorCode(sendErr),
		)
	} else {
		log.Printf("whatsmeow send terminal failure worker_id=%s message_id_hash=%s chat_id_hash=%s account_id=%s error_code=%s", w.cfg.WorkerID, hashConnectionFlowIdentifier(messageID), hashConnectionFlowIdentifier(chatID), accountID, safeOperationalErrorCode(sendErr))
	}
	if messageID == "" {
		return nil
	}
	connectionScope, hasCapturedScope := inboundConnectionScopeFromContext(ctx)
	if !hasCapturedScope {
		var err error
		connectionScope, err = w.whatsapp.captureActiveConnectionScope(ctx)
		if err != nil {
			return err
		}
	}
	update := newMessageNotSentStatusUpdate(
		w.cfg.WorkerID,
		accountID,
		connectionScope,
		messageID,
		chatID,
	)
	if err := w.whatsapp.assertCapturedConnectionScope(ctx, connectionScope); err != nil {
		return err
	}
	if err := w.runKafkaRepublishWithConnectionAuthorization(ctx, connectionScope, func(publishCtx context.Context) error {
		return w.kafka.SendJSON(
			publishCtx,
			topicUpdateMessageStatus,
			messageStatusKafkaKey(accountID, w.cfg.WorkerID, messageID),
			update,
		)
	}); err != nil {
		log.Printf("whatsmeow send status publish failed worker_id=%s message_id_hash=%s chat_id_hash=%s account_id=%s topic=%s error_code=%s", w.cfg.WorkerID, hashConnectionFlowIdentifier(messageID), hashConnectionFlowIdentifier(chatID), accountID, topicUpdateMessageStatus, safeOperationalErrorCode(err))
		return err
	}
	return nil
}

func logKafkaPayloadDecodeError(workerID string, msg kafka.Message, err error) {
	log.Printf("whatsmeow kafka payload decode failed worker_id=%s topic=%s partition=%d offset=%d payload_bytes=%d error_code=%s", workerID, msg.Topic, msg.Partition, msg.Offset, len(msg.Value), safeOperationalErrorCode(err))
}

func (w *Worker) logOutgoingKafkaRawDebug(stage string, msg kafka.Message) {
	if !messageDebugEnabledForAccount(w.cfg, "") {
		return
	}
	log.Printf(
		"message_debug direction=out stage=%s event_type=kafka_message worker_id=%s account_id=%s topic=%s partition=%d offset=%d kafka_key_hash=%s payload_sha256=%x payload_bytes=%d",
		stage,
		w.cfg.WorkerID,
		w.cfg.AccountID,
		msg.Topic,
		msg.Partition,
		msg.Offset,
		hashConnectionFlowIdentifier(string(msg.Key)),
		sha256.Sum256(msg.Value),
		len(msg.Value),
	)
}

func (w *Worker) logOutgoingKafkaDecodeErrorDebug(msg kafka.Message, err error) {
	if !messageDebugEnabledForAccount(w.cfg, "") {
		return
	}
	log.Printf(
		"message_debug direction=out stage=whatsmeow.outgoing.kafka.decode.error event_type=kafka_message worker_id=%s account_id=%s topic=%s partition=%d offset=%d kafka_key_hash=%s payload_sha256=%x payload_bytes=%d error_code=%s",
		w.cfg.WorkerID,
		w.cfg.AccountID,
		msg.Topic,
		msg.Partition,
		msg.Offset,
		hashConnectionFlowIdentifier(string(msg.Key)),
		sha256.Sum256(msg.Value),
		len(msg.Value),
		safeOperationalErrorCode(err),
	)
}

func (w *Worker) logOutgoingKafkaDecodedDebug(msg kafka.Message, payloadType, messageID, chatID, messageType, accountID string) {
	if !messageDebugEnabledForAccount(w.cfg, accountID) {
		return
	}
	log.Printf(
		"message_debug direction=out stage=whatsmeow.outgoing.kafka.decoded event_type=kafka_message worker_id=%s account_id=%s payload_type=%s topic=%s partition=%d offset=%d kafka_key_hash=%s message_id_hash=%s chat_id_hash=%s message_type=%s",
		w.cfg.WorkerID,
		firstNonEmpty(accountID, w.cfg.AccountID),
		payloadType,
		msg.Topic,
		msg.Partition,
		msg.Offset,
		hashConnectionFlowIdentifier(string(msg.Key)),
		hashConnectionFlowIdentifier(messageID),
		hashConnectionFlowIdentifier(chatID),
		messageType,
	)
}

func (w *Worker) logOutgoingMessageStepDebug(stage string, msg kafka.Message, data ChatMessage, detail map[string]any, err error) {
	accountID := firstNonEmpty(stringValue(data.Account["id"]), w.cfg.AccountID)
	if !messageDebugEnabledForAccount(w.cfg, accountID) {
		return
	}
	if detail == nil {
		detail = map[string]any{}
	}
	log.Printf(
		"message_debug direction=out stage=%s worker_id=%s account_id=%s topic=%s partition=%d offset=%d kafka_key_hash=%s message_id_hash=%s chat_id_hash=%s message_type=%s phone_hash=%s text_bytes=%d detail_field_count=%d detail_fields=%q error_code=%s",
		stage,
		w.cfg.WorkerID,
		accountID,
		msg.Topic,
		msg.Partition,
		msg.Offset,
		hashConnectionFlowIdentifier(string(msg.Key)),
		hashConnectionFlowIdentifier(data.MessageID),
		hashConnectionFlowIdentifier(data.ChatID),
		chatMessageType(data),
		hashConnectionFlowIdentifier(data.Phone),
		len([]byte(outgoingMessageTextPreview(data))),
		len(detail),
		mapLogFieldNames(detail),
		safeOperationalErrorCode(err),
	)
}

func chatMessageType(data ChatMessage) string {
	messageType := strings.TrimSpace(stringValue(data.Content["type"]))
	if messageType == "" {
		return MessageTypeText
	}
	return messageType
}

func outboundUpdateKafkaKey(accountID, workerID, messageID string) string {
	return strings.Join([]string{
		strings.TrimSpace(accountID),
		strings.TrimSpace(workerID),
		strings.TrimSpace(messageID),
	}, ":")
}

func scheduleStatusKafkaKey(scheduleID, contactID, messageID string) string {
	return strings.Join([]string{
		strings.TrimSpace(scheduleID),
		strings.TrimSpace(contactID),
		strings.TrimSpace(messageID),
	}, ":")
}

func (w *Worker) publishOutboundUpdate(ctx context.Context, accountID, messageID string, update any) error {
	publication, err := newOutboundRecoveryPublication(
		topicUpdateMessage,
		outboundUpdateKafkaKey(accountID, w.cfg.WorkerID, messageID),
		update,
	)
	if err != nil {
		return err
	}
	return retryOutboundPostProviderSideEffect(ctx, func(attemptCtx context.Context) error {
		if err := w.assertOutboundRecoveryPublicationScope(attemptCtx, publication); err != nil {
			return err
		}
		return w.runKafkaRepublishAuthorized(attemptCtx, func(publishCtx context.Context) error {
			return w.kafka.SendJSON(publishCtx, publication.Topic, publication.Key, update)
		})
	})
}

func (w *Worker) publishScheduleStatus(ctx context.Context, data ScheduleMessage, status string) error {
	connectionScope, hasCapturedScope := inboundConnectionScopeFromContext(ctx)
	if !hasCapturedScope {
		var err error
		connectionScope, err = w.whatsapp.captureActiveConnectionScope(ctx)
		if err != nil {
			return err
		}
	}
	update := ScheduleStatusUpdate{
		AttemptID:         data.AttemptID,
		AccountID:         firstNonEmpty(stringValue(data.Message.Account["id"]), data.AccountID, w.cfg.AccountID),
		WorkerID:          w.cfg.WorkerID,
		SourceProvider:    "whatsmeow",
		RuntimeGeneration: connectionScope.RuntimeGeneration,
		ConnectionEpoch:   connectionScope.ConnectionEpoch,
		ScheduleID:        data.ScheduleID,
		ContactID:         data.ContactID,
		MessageID:         data.Message.MessageID,
		Status:            status,
	}
	ensureScheduleStatusEventID(&update)
	return retryOutboundPostProviderSideEffect(ctx, func(attemptCtx context.Context) error {
		// Keep retries of the same logical status stable apart from the publish
		// attempt itself; consumers may use this timestamp for observability.
		if update.ProcessedAt == "" {
			update.ProcessedAt = nowISO()
		}
		return w.runKafkaRepublishWithConnectionAuthorization(attemptCtx, connectionScope, func(publishCtx context.Context) error {
			if err := w.assertScheduleMessageAttemptFromContext(publishCtx); err != nil {
				return err
			}
			return w.kafka.SendJSON(
				publishCtx,
				topicScheduleStatusUpdate,
				scheduleStatusKafkaKey(data.ScheduleID, data.ContactID, data.Message.MessageID),
				update,
			)
		})
	})
}

func nestedString(root map[string]any, dottedPath string) string {
	var current any = root
	for _, part := range strings.Split(dottedPath, ".") {
		if current == nil {
			return ""
		}
		mapped := asMap(current)
		if mapped == nil {
			return ""
		}
		current = mapped[part]
	}
	return stringValue(current)
}

func (w *Worker) validateOutboundPayloadIdentity(
	payloadType string,
	accountIDs []string,
	workerIDs []string,
) error {
	expectedAccountID := strings.TrimSpace(w.cfg.AccountID)
	expectedWorkerID := strings.TrimSpace(w.cfg.WorkerID)
	if expectedAccountID == "" || expectedWorkerID == "" {
		return fmt.Errorf(
			"%s cannot be routed without configured account_id and worker_id",
			payloadType,
		)
	}

	hasAccountID := false
	for _, candidate := range accountIDs {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" {
			continue
		}
		hasAccountID = true
		if candidate != expectedAccountID {
			return fmt.Errorf(
				"%s account_id mismatch expected=%s actual=%s",
				payloadType,
				expectedAccountID,
				candidate,
			)
		}
	}
	if !hasAccountID {
		return fmt.Errorf("%s account_id is required", payloadType)
	}

	hasWorkerID := false
	for _, candidate := range workerIDs {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" {
			continue
		}
		hasWorkerID = true
		if candidate != expectedWorkerID {
			return fmt.Errorf(
				"%s worker_id mismatch expected=%s actual=%s",
				payloadType,
				expectedWorkerID,
				candidate,
			)
		}
	}
	if !hasWorkerID {
		return fmt.Errorf("%s worker_id is required", payloadType)
	}
	return nil
}

func (w *Worker) discardInvalidOutboundPayload(
	msg kafka.Message,
	payloadType string,
	err error,
) error {
	log.Printf(
		"whatsmeow outbound payload terminally discarded worker_id=%s account_id=%s payload_type=%s topic=%s partition=%d offset=%d error_code=%s",
		w.cfg.WorkerID,
		w.cfg.AccountID,
		payloadType,
		msg.Topic,
		msg.Partition,
		msg.Offset,
		safeOperationalErrorCode(err),
	)
	// Malformed and cross-routed records are terminal input errors. Commit them
	// without touching Redis, phone lookup, upload, typing, or the provider.
	return nil
}

func validationError(err error, resp PhoneValidationResponse) error {
	if err != nil {
		return err
	}
	if resp.Error != "" {
		return terminalKafkaHandlerError(fmt.Errorf("phone validation rejected: %s", resp.Error))
	}
	return terminalKafkaHandlerError(errors.New("phone validation rejected: phone is not registered on WhatsApp"))
}

func isOutboundTargetBusinessRejection(err error) bool {
	return errors.Is(err, errOutboundTargetNotRegistered) ||
		errors.Is(err, errOutboundTargetInvalid)
}

// isPermanentOutboundPreProviderFailure is intentionally conservative. Only
// failures which prove that the same immutable payload cannot succeed are
// terminal. Readiness, fencing, admission, typing, network, timeout, provider
// capacity, and upstream 5xx failures stay retryable without a Kafka commit.
func isPermanentOutboundPreProviderFailure(err error) bool {
	if err == nil {
		return false
	}
	if isOutboundTargetBusinessRejection(err) ||
		errors.Is(err, errOutboundPayloadInvalid) ||
		errors.Is(err, errMediaDownloadTooLarge) ||
		errors.Is(err, errMediaDownloadInvalidURL) {
		return true
	}

	var unsupported UnsupportedFeatureError
	if errors.As(err, &unsupported) {
		return true
	}

	var downloadHTTPError *mediaDownloadHTTPError
	if errors.As(err, &downloadHTTPError) {
		return downloadHTTPError.StatusCode >= http.StatusBadRequest &&
			downloadHTTPError.StatusCode < http.StatusInternalServerError &&
			!downloadHTTPError.Transient()
	}
	return false
}

func (w *Worker) retryTransientOutboundPreProviderFailure(
	ctx context.Context,
	claim outboundSendClaim,
	recoveryPrepared bool,
	cause error,
) error {
	w.releaseOutboundReservationBestEffort(ctx, claim, recoveryPrepared)
	if cause == nil {
		cause = errors.New("transient outbound pre-provider failure")
	}
	return restartKafkaGenerationWithoutCommit(fmt.Errorf(
		"transient outbound pre-provider failure: %w",
		nonTerminalKafkaHandlerCause(cause),
	))
}

func terminalizePermanentOutboundPreProviderFailure(
	cause error,
	persist func() error,
) error {
	if !isPermanentOutboundPreProviderFailure(cause) {
		return cause
	}
	if persist == nil {
		return errors.Join(cause, errors.New("outbound permanent failure persistence is required"))
	}
	if err := persist(); err != nil {
		// Persistence uncertainty must never retain a terminal Kafka marker.
		return errors.Join(cause, err)
	}
	return terminalKafkaHandlerError(cause)
}

func terminalizeOutboundTargetBusinessRejection(
	cause error,
	persist func() error,
) error {
	if !isOutboundTargetBusinessRejection(cause) {
		return cause
	}
	return terminalizePermanentOutboundPreProviderFailure(cause, persist)
}

func hashRaw(raw map[string]any) string {
	if len(raw) == 0 {
		return randomHex(8)
	}
	payload, err := json.Marshal(raw)
	if err != nil {
		return randomHex(8)
	}
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:8])
}
