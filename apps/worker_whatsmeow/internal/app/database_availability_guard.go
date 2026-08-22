package app

import (
	"context"
	"errors"
	"log"
	"time"
)

const (
	workerDatabaseOutageThreshold = 30 * time.Second
	workerDatabaseProbeInterval   = 2 * time.Second
	workerDatabaseRecoveryTimeout = 15 * time.Second
)

type databaseAvailabilityGuard struct {
	outageThreshold time.Duration
	probeInterval   time.Duration
	probeTimeout    time.Duration
	probe           func(context.Context) error
	recoveryProbe   func(context.Context) error
	suspend         func(context.Context) error
	recover         func(context.Context) error

	unavailableSince time.Time
	suspended        bool
}

func (g *databaseAvailabilityGuard) run(ctx context.Context) {
	if g == nil || g.probe == nil {
		return
	}
	if g.probeInterval <= 0 {
		g.probeInterval = workerDatabaseProbeInterval
	}
	ticker := time.NewTicker(g.probeInterval)
	defer ticker.Stop()
	for {
		g.step(ctx, time.Now())
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (g *databaseAvailabilityGuard) step(ctx context.Context, observedAt time.Time) {
	if ctx == nil || ctx.Err() != nil || g.probe == nil {
		return
	}
	probeCtx := ctx
	cancel := func() {}
	if g.probeTimeout > 0 {
		probeCtx, cancel = context.WithTimeout(ctx, g.probeTimeout)
	}
	probe := g.probe
	if g.suspended && g.recoveryProbe != nil {
		// Session lease loss is intentionally sticky until a fresh lease is
		// acquired. Once fail-closed suspension is active, probe PostgreSQL
		// directly so database recovery can unlock that reacquisition attempt.
		probe = g.recoveryProbe
	}
	err := probe(probeCtx)
	cancel()
	if err != nil {
		leaseLost := errors.Is(err, ErrWhatsAppSessionLeaseLost)
		if g.unavailableSince.IsZero() {
			g.unavailableSince = observedAt
		}
		// A lost or locally unsafe lease is a writer-fence failure. Suspend
		// immediately; ordinary database outages keep the configured grace period.
		if g.suspended || (!leaseLost && observedAt.Sub(g.unavailableSince) < g.outageThreshold) {
			return
		}
		if g.suspend != nil {
			suspendCtx, suspendCancel := context.WithTimeout(context.WithoutCancel(ctx), workerDatabaseRecoveryTimeout)
			err = g.suspend(suspendCtx)
			suspendCancel()
			if err != nil {
				return
			}
		}
		g.suspended = true
		return
	}

	if !g.suspended {
		g.unavailableSince = time.Time{}
		return
	}
	if g.recover != nil {
		recoverCtx, recoverCancel := context.WithTimeout(context.WithoutCancel(ctx), workerDatabaseRecoveryTimeout)
		err = g.recover(recoverCtx)
		recoverCancel()
		if err != nil {
			return
		}
	}
	g.suspended = false
	g.unavailableSince = time.Time{}
}

func (w *Worker) startDatabaseAvailabilityGuard(ctx context.Context) {
	if w == nil || w.postgres == nil {
		return
	}
	w.databaseGuardOnce.Do(func() {
		guard := &databaseAvailabilityGuard{
			outageThreshold: workerDatabaseOutageThreshold,
			probeInterval:   workerDatabaseProbeInterval,
			probeTimeout:    workerDatabasePingTimeout,
			probe:           w.postgres.Ping,
			recoveryProbe:   w.postgres.PingDatabase,
			suspend:         w.suspendForDatabaseOutage,
			recover:         w.recoverFromDatabaseOutage,
		}
		go guard.run(ctx)
	})
}

func (w *Worker) suspendForDatabaseOutage(ctx context.Context) error {
	manager := w.currentWhatsApp()
	if manager == nil {
		return errors.New("whatsmeow runtime is not initialized")
	}
	w.databaseSuspended.Store(true)
	w.kafkaConsumersReady.Store(false)
	w.revokeKafkaConsumerAuthorization()
	w.invalidateKafkaConsumerBarrier()
	manager.SuspendForDatabaseOutage(ctx)
	select {
	case w.kafkaConsumerRestart <- struct{}{}:
	default:
	}
	log.Printf("whatsmeow runtime suspended worker_id=%s reason=worker_database_unavailable", w.cfg.WorkerID)
	return nil
}

func (w *Worker) recoverFromDatabaseOutage(ctx context.Context) error {
	manager := w.currentWhatsApp()
	if manager == nil {
		return errors.New("whatsmeow runtime is not initialized")
	}
	w.runtimeMu.RLock()
	cfg := w.cfg
	w.runtimeMu.RUnlock()
	leaseReacquired := false
	if cfg.SessionStorage == SessionStoragePostgres {
		if err := w.postgres.ReacquireSessionLease(ctx, cfg); err != nil {
			return err
		}
		leaseReacquired = true
	}
	if err := manager.PrepareDatabaseRecoveryFence(ctx); err != nil {
		// A stale runtime must not retain the channel lease merely because it won
		// a race before its durable runtime fence was rejected.
		// Consumers/provider remain suspended and the authoritative successor is
		// free to acquire the lease immediately.
		if leaseReacquired {
			releaseCtx, releaseCancel := context.WithTimeout(
				context.WithoutCancel(ctx),
				workerDatabaseRecoveryTimeout,
			)
			releaseErr := w.postgres.ReleaseSessionLease(releaseCtx)
			releaseCancel()
			if releaseErr != nil {
				return errors.Join(err, releaseErr)
			}
		}
		return err
	}
	if err := manager.ResumeAfterDatabaseRecovery(ctx); err != nil {
		if leaseReacquired {
			releaseCtx, releaseCancel := context.WithTimeout(
				context.WithoutCancel(ctx),
				workerDatabaseRecoveryTimeout,
			)
			releaseErr := w.postgres.ReleaseSessionLease(releaseCtx)
			releaseCancel()
			if releaseErr != nil {
				return errors.Join(err, releaseErr)
			}
		}
		return err
	}
	w.databaseSuspended.Store(false)
	log.Printf("whatsmeow runtime database recovered worker_id=%s lease_reacquired=true", cfg.WorkerID)
	return nil
}
