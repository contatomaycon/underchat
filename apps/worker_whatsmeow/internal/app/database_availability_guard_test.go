package app

import (
	"context"
	"errors"
	"fmt"
	"net"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/redis/go-redis/v9"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
)

type databaseRecoveryRedisHook struct {
	mu            sync.Mutex
	workerID      string
	active        string
	beginCalls    int
	finalizeCalls int
}

func (*databaseRecoveryRedisHook) DialHook(next redis.DialHook) redis.DialHook {
	return next
}

func (h *databaseRecoveryRedisHook) ProcessHook(_ redis.ProcessHook) redis.ProcessHook {
	return func(_ context.Context, command redis.Cmder) error {
		h.mu.Lock()
		defer h.mu.Unlock()

		switch command.Name() {
		case "eval":
			args := command.Args()
			if len(args) < 2 {
				return errors.New("Redis EVAL omitted the script")
			}
			script, _ := args[1].(string)
			result, ok := command.(*redis.Cmd)
			if !ok {
				return fmt.Errorf("unexpected EVAL command type %T", command)
			}
			switch script {
			case beginWhatsAppRuntimeFenceActivationScript:
				h.beginCalls++
				result.SetVal([]any{
					int64(1),
					int64(1),
					time.Now().UnixMilli(),
					int64(0),
					int64(0),
				})
				result.SetErr(nil)
				return nil
			case finalizeWhatsAppRuntimeFenceActivationScript:
				// EVAL, script, key count, four keys, then five arguments.
				if len(args) < 12 {
					return fmt.Errorf("unexpected runtime-fence finalize arguments: %d", len(args))
				}
				generation, err := strconv.Atoi(fmt.Sprint(args[7]))
				if err != nil {
					return fmt.Errorf("parse runtime generation: %w", err)
				}
				activationOrder, err := strconv.ParseInt(fmt.Sprint(args[10]), 10, 64)
				if err != nil {
					return fmt.Errorf("parse activation order: %w", err)
				}
				connectionSequence, err := strconv.ParseInt(fmt.Sprint(args[11]), 10, 64)
				if err != nil {
					return fmt.Errorf("parse connection sequence: %w", err)
				}
				h.finalizeCalls++
				h.active = fmt.Sprintf(
					`{"state":"active","worker_id":%q,"runtime_generation":%d,"connection_epoch":%q,"connection_sequence":%d,"source_provider":%q,"activated_at":%d,"activation_order":%d}`,
					h.workerID,
					generation,
					fmt.Sprint(args[8]),
					connectionSequence,
					fmt.Sprint(args[9]),
					time.Now().UnixMilli(),
					activationOrder,
				)
				result.SetVal(int64(1))
				result.SetErr(nil)
				return nil
			case deactivateWhatsAppRuntimeFenceScript:
				h.active = ""
				result.SetVal(int64(1))
				result.SetErr(nil)
				return nil
			default:
				return errors.New("unexpected Redis EVAL script")
			}
		case "get":
			result, ok := command.(*redis.StringCmd)
			if !ok {
				return fmt.Errorf("unexpected GET command type %T", command)
			}
			if h.active == "" {
				result.SetErr(redis.Nil)
				return redis.Nil
			}
			result.SetVal(h.active)
			result.SetErr(nil)
			return nil
		default:
			// Inbound-spool cleanup starts asynchronously after activation. It is
			// outside this guard test; fail its first command without touching the
			// runtime-fence state modeled above.
			return fmt.Errorf("unexpected Redis command %q", command.Name())
		}
	}
}

func (*databaseRecoveryRedisHook) ProcessPipelineHook(next redis.ProcessPipelineHook) redis.ProcessPipelineHook {
	return next
}

func (h *databaseRecoveryRedisHook) counts() (int, int) {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.beginCalls, h.finalizeCalls
}

type databaseRecoveryBlockingDialer struct {
	mu      sync.Mutex
	calls   int
	started chan int
}

func (dialer *databaseRecoveryBlockingDialer) Dial(_, _ string) (net.Conn, error) {
	return nil, errors.New("database recovery test requires context-aware dialing")
}

func (dialer *databaseRecoveryBlockingDialer) DialContext(
	ctx context.Context,
	_, _ string,
) (net.Conn, error) {
	dialer.mu.Lock()
	dialer.calls++
	call := dialer.calls
	dialer.mu.Unlock()
	select {
	case dialer.started <- call:
	default:
	}
	<-ctx.Done()
	return nil, ctx.Err()
}

func (dialer *databaseRecoveryBlockingDialer) callCount() int {
	dialer.mu.Lock()
	defer dialer.mu.Unlock()
	return dialer.calls
}

func TestDatabaseAvailabilityGuardSuspendsOnlyAfterContinuousThresholdAndRecovers(t *testing.T) {
	available := false
	suspends := 0
	recoveries := 0
	guard := &databaseAvailabilityGuard{
		outageThreshold: 30 * time.Second,
		probe: func(context.Context) error {
			if available {
				return nil
			}
			return errors.New("database unavailable")
		},
		suspend: func(context.Context) error {
			suspends++
			return nil
		},
		recover: func(context.Context) error {
			recoveries++
			return nil
		},
	}
	ctx := context.Background()
	start := time.Unix(100, 0)
	guard.step(ctx, start)
	guard.step(ctx, start.Add(29*time.Second))
	if suspends != 0 {
		t.Fatalf("suspended before threshold: %d", suspends)
	}
	guard.step(ctx, start.Add(30*time.Second))
	guard.step(ctx, start.Add(35*time.Second))
	if suspends != 1 || !guard.suspended {
		t.Fatalf("expected one fail-closed suspension, got suspends=%d suspended=%t", suspends, guard.suspended)
	}

	available = true
	guard.step(ctx, start.Add(36*time.Second))
	if recoveries != 1 || guard.suspended {
		t.Fatalf("expected one recovery, got recoveries=%d suspended=%t", recoveries, guard.suspended)
	}
}

func TestDatabaseAvailabilityGuardRequiresSuccessfulRecovery(t *testing.T) {
	available := false
	recoveryAllowed := false
	guard := &databaseAvailabilityGuard{
		outageThreshold: time.Second,
		probe: func(context.Context) error {
			if available {
				return nil
			}
			return errors.New("database unavailable")
		},
		suspend: func(context.Context) error { return nil },
		recover: func(context.Context) error {
			if !recoveryAllowed {
				return errors.New("fence not reacquired")
			}
			return nil
		},
	}
	ctx := context.Background()
	start := time.Unix(200, 0)
	guard.step(ctx, start)
	guard.step(ctx, start.Add(time.Second))
	available = true
	guard.step(ctx, start.Add(2*time.Second))
	if !guard.suspended {
		t.Fatal("guard resumed without a successful fence reacquisition")
	}
	recoveryAllowed = true
	guard.step(ctx, start.Add(3*time.Second))
	if guard.suspended {
		t.Fatal("guard did not resume after successful fence reacquisition")
	}
}

func TestDatabaseAvailabilityGuardSuspendsImmediatelyWhenSessionLeaseIsLost(t *testing.T) {
	suspends := 0
	guard := &databaseAvailabilityGuard{
		outageThreshold: 30 * time.Second,
		probe: func(context.Context) error {
			return ErrWhatsAppSessionLeaseLost
		},
		suspend: func(context.Context) error {
			suspends++
			return nil
		},
	}

	guard.step(context.Background(), time.Unix(300, 0))
	if suspends != 1 || !guard.suspended {
		t.Fatalf("expected immediate lease-loss suspension, got suspends=%d suspended=%t", suspends, guard.suspended)
	}
}

func TestDatabaseAvailabilityGuardReacquiresLostLeaseAndResumesSameWhatsmeowClientOnce(t *testing.T) {
	database, sqlMock, err := sqlmock.New(sqlmock.MonitorPingsOption(true))
	if err != nil {
		t.Fatalf("create SQL mock: %v", err)
	}

	const (
		workerID        = "019fce0d-1d24-7000-8000-000000000080"
		accountID       = "019fce0d-1d24-7000-8000-000000000081"
		leaseOwnerID    = "019fce0d-1d24-7000-8000-000000000082"
		writerEpoch     = "019fce0d-1d24-7000-8000-000000000083"
		runtimeToken    = "0123456789abcdef0123456789abcdef"
		runtimeGen      = 13
		oldFencing      = int64(41)
		freshFencing    = int64(42)
		sessionRevision = int64(29)
	)
	cfg := Config{
		WorkerID:          workerID,
		AccountID:         accountID,
		RuntimeGeneration: runtimeGen,
		RuntimeCapability: runtimeToken,
		WriterEpoch:       writerEpoch,
		SessionStorage:    SessionStoragePostgres,
	}

	oldLeaseCancel := func() {}
	oldLeaseDone := make(chan struct{})
	close(oldLeaseDone)
	postgres := &WorkerPostgres{
		DB: database,
		lease: &whatsappSessionLeaseState{
			sessionID:     workerID,
			provider:      "whatsmeow",
			ownerID:       leaseOwnerID,
			fencingToken:  oldFencing,
			generation:    runtimeGen,
			epoch:         writerEpoch,
			capability:    runtimeToken,
			expiresAt:     time.Now().Add(time.Minute),
			localDeadline: time.Now().Add(time.Minute),
		},
		leaseOwnerID: leaseOwnerID,
		leaseCancel:  oldLeaseCancel,
		leaseDone:    oldLeaseDone,
	}
	fenceContainer := &workerConnectionStatusFenceContainer{fence: store.ConnectionStatusFence{
		Required: true, OwnerID: leaseOwnerID, FencingToken: oldFencing,
		Generation: runtimeGen, Epoch: writerEpoch,
	}}
	jid := types.NewJID("15550000008", types.DefaultUserServer)
	client := whatsmeow.NewClient(&store.Device{
		ID: &jid, SessionID: workerID, RevisionID: sessionRevision,
		Container: fenceContainer,
	}, nil)
	dialer := &databaseRecoveryBlockingDialer{started: make(chan int, 4)}
	client.SetSOCKSProxy(dialer)

	runtimeContext, cancelRuntime := context.WithCancel(context.Background())
	redisHook := &databaseRecoveryRedisHook{workerID: workerID}
	redisClient := redis.NewClient(&redis.Options{Addr: "127.0.0.1:1", MaxRetries: 0})
	redisClient.AddHook(redisHook)

	var (
		stepsMu       sync.Mutex
		steps         []string
		restoringOnce sync.Once
		restoring     = make(chan struct{})
		qrEvents      int
	)
	recordStep := func(step string) {
		stepsMu.Lock()
		steps = append(steps, step)
		stepsMu.Unlock()
	}
	client.AddEventHandler(func(rawEvent any) {
		status, ok := rawEvent.(*events.ConnectionStatus)
		if !ok {
			return
		}
		switch status.Status {
		case events.ConnectionStatusRestoring:
			recordStep("resume")
			restoringOnce.Do(func() { close(restoring) })
		case events.ConnectionStatusQR:
			stepsMu.Lock()
			qrEvents++
			stepsMu.Unlock()
		}
	})

	manager := &WhatsAppManager{
		cfg:                     cfg,
		redis:                   redisClient,
		postgres:                postgres,
		runtimeCtx:              runtimeContext,
		client:                  client,
		status:                  "connected",
		code:                    CodeConnectionEstablished,
		inboundSpoolPublished:   make(map[string]struct{}),
		nativeStatusPublishWake: make(chan struct{}, 1),
		providerFlights:         make(map[*whatsmeow.Client]map[string]struct{}),
		providerStalled:         make(map[*whatsmeow.Client]struct{}),
		runtimeFenceRetryRandom: func() uint64 { return 0 },
		activateRuntimeFence: func(_ context.Context, request WhatsappRuntimeFenceActivationRequest) (WhatsappRuntimeFenceActivationResponse, error) {
			ownerID, token, generation, epoch, _, fenceErr := postgres.SessionOperationFence()
			if fenceErr != nil || token != freshFencing {
				return WhatsappRuntimeFenceActivationResponse{}, fmt.Errorf(
					"durable fence ran before lease reacquire: token=%d error=%v",
					token,
					fenceErr,
				)
			}
			if request.WorkerID != workerID || request.RuntimeGeneration != runtimeGen || request.SourceProvider != "whatsmeow" {
				return WhatsappRuntimeFenceActivationResponse{}, fmt.Errorf("unexpected runtime fence request: %+v", request)
			}
			recordStep("reacquire")
			recordStep("prepare")
			fenceContainer.fence = store.ConnectionStatusFence{
				Required: true, OwnerID: ownerID, FencingToken: token,
				Generation: int64(generation), Epoch: epoch,
			}
			return WhatsappRuntimeFenceActivationResponse{
				Activated:          true,
				ConnectionSequence: 73,
			}, nil
		},
	}
	postgres.SetSessionLeaseLostHandler(manager.handleSessionLeaseLost)
	worker := &Worker{
		cfg:                  cfg,
		postgres:             postgres,
		whatsapp:             manager,
		kafkaConsumerRestart: make(chan struct{}, 1),
	}

	t.Cleanup(func() {
		cancelRuntime()
		postgres.leaseMu.Lock()
		cancelLease := postgres.leaseCancel
		leaseDone := postgres.leaseDone
		postgres.leaseCancel = nil
		postgres.leaseDone = nil
		postgres.leaseMu.Unlock()
		if cancelLease != nil {
			cancelLease()
		}
		if leaseDone != nil {
			select {
			case <-leaseDone:
			case <-time.After(time.Second):
				t.Error("session lease renewal did not stop")
			}
		}
		_ = redisClient.Close()
		_ = database.Close()
	})

	postgres.leaseMu.Lock()
	leaseLostHandler, notifyLeaseLost := postgres.markSessionLeaseLostLocked()
	postgres.leaseMu.Unlock()
	if !notifyLeaseLost || leaseLostHandler == nil {
		t.Fatal("session lease loss did not synchronously select the provider suspension handler")
	}
	leaseLostHandler()
	lost := client.GetConnectionStatus()
	if lost.Status != events.ConnectionStatusLeaseLost || lost.Connected ||
		lost.SessionValid == nil || !*lost.SessionValid || client.Store.ID == nil || client.Store.Deleted {
		t.Fatalf("lease loss destroyed or misreported the persisted session: %+v", lost)
	}
	if worker.currentWhatsApp() != manager || manager.getClient() != client {
		t.Fatal("lease loss replaced the WhatsMeow manager or provider client")
	}

	sqlMock.ExpectPing()
	sqlMock.ExpectQuery(`SELECT fencing_token, expires_at, remaining_ms`).
		WithArgs(
			workerID,
			leaseOwnerID,
			runtimeGen,
			writerEpoch,
			whatsappSessionLeaseTTL.Milliseconds(),
			runtimeToken,
		).
		WillReturnRows(sqlmock.NewRows([]string{"fencing_token", "expires_at", "remaining_ms"}).
			AddRow(freshFencing, time.Now().Add(whatsappSessionLeaseTTL), whatsappSessionLeaseTTL.Milliseconds()))
	sqlMock.ExpectPing()

	recoveryCalls := 0
	var recoveryErr error
	guard := &databaseAvailabilityGuard{
		outageThreshold: workerDatabaseOutageThreshold,
		probe:           postgres.Ping,
		recoveryProbe:   postgres.PingDatabase,
		suspend: func(ctx context.Context) error {
			recordStep("suspend")
			return worker.suspendForDatabaseOutage(ctx)
		},
		recover: func(ctx context.Context) error {
			recoveryCalls++
			recoveryErr = worker.recoverFromDatabaseOutage(ctx)
			return recoveryErr
		},
	}
	startedAt := time.Unix(400, 0)
	guard.step(context.Background(), startedAt)
	if !guard.suspended || !worker.databaseSuspended.Load() {
		t.Fatal("lease loss did not suspend the worker immediately inside the ordinary 30-second grace")
	}
	if worker.currentWhatsApp() != manager || manager.getClient() != client {
		t.Fatal("database suspension recreated the WhatsMeow manager or provider client")
	}

	guard.step(context.Background(), startedAt.Add(time.Second))
	if guard.suspended || worker.databaseSuspended.Load() {
		t.Fatalf("healthy short-outage probe did not complete fenced database recovery: %v", recoveryErr)
	}
	select {
	case <-restoring:
	case <-time.After(time.Second):
		t.Fatal("reacquired lease did not resume the persisted provider session")
	}
	select {
	case call := <-dialer.started:
		if call != 1 {
			t.Fatalf("first resumed provider dial had call number %d", call)
		}
	case <-time.After(time.Second):
		t.Fatal("database recovery did not start the provider connection")
	}

	resumed := client.GetConnectionStatus()
	if resumed.Status != events.ConnectionStatusConnecting || resumed.Connected ||
		resumed.SessionValid == nil || !*resumed.SessionValid || client.Store.ID == nil || client.Store.Deleted {
		t.Fatalf("database recovery did not retain the valid persisted session: %+v", resumed)
	}
	if worker.currentWhatsApp() != manager || manager.getClient() != client {
		t.Fatal("database recovery replaced the WhatsMeow manager or provider client")
	}
	if manager.qrGenerationCount != 0 {
		t.Fatalf("database recovery started a QR lifecycle: generations=%d", manager.qrGenerationCount)
	}

	guard.step(context.Background(), startedAt.Add(2*time.Second))
	if recoveryCalls != 1 {
		t.Fatalf("healthy probes duplicated database recovery: calls=%d", recoveryCalls)
	}
	beginCalls, finalizeCalls := redisHook.counts()
	if beginCalls != 1 || finalizeCalls != 1 {
		t.Fatalf("database recovery duplicated the runtime fence: begin=%d finalize=%d", beginCalls, finalizeCalls)
	}
	if dialer.callCount() != 1 {
		t.Fatalf("database recovery duplicated the provider socket: dials=%d", dialer.callCount())
	}
	stepsMu.Lock()
	gotSteps := append([]string(nil), steps...)
	gotQREvents := qrEvents
	stepsMu.Unlock()
	wantSteps := []string{"suspend", "reacquire", "prepare", "resume"}
	if len(gotSteps) < len(wantSteps) {
		t.Fatalf("incomplete database recovery order: got=%v want-prefix=%v", gotSteps, wantSteps)
	}
	if fmt.Sprint(gotSteps[:len(wantSteps)]) != fmt.Sprint(wantSteps) {
		t.Fatalf("unexpected database recovery order: got=%v want-prefix=%v", gotSteps, wantSteps)
	}
	if gotQREvents != 0 {
		t.Fatalf("database recovery emitted %d QR lifecycle events", gotQREvents)
	}
	if err := sqlMock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet database recovery expectations: %v", err)
	}
}
