package main

import (
	"context"
	"errors"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"underchat/apps/worker_whatsmeow/internal/app"
)

func main() {
	log.SetFlags(log.LstdFlags | log.Lmicroseconds | log.LUTC)
	log.Printf("worker_whatsmeow booting pid=%d", os.Getpid())

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	cfg, err := app.LoadConfig()
	if err != nil {
		log.Fatalf("invalid config: %v", err)
	}
	log.Printf(
		"worker_whatsmeow config loaded worker_id=%s account_id=%s http_addr=%s grpc_addr=%s kafka_brokers=%d redis=%s:%d balance_grpc=%s otel_enabled=%t centrifugo_configured=%t s3_configured=%t s3_backup_configured=%t",
		cfg.WorkerID,
		cfg.AccountID,
		cfg.HTTPAddr,
		cfg.GRPCAddr,
		len(cfg.KafkaBrokers),
		cfg.RedisHost,
		cfg.RedisPort,
		cfg.BalanceGRPCAddress(),
		cfg.OTELEnabled,
		cfg.CentrifugoHTTPAPIURL != "" && cfg.CentrifugoHTTPAPIKey != "",
		cfg.S3Endpoint != "" && cfg.S3AccessKeyID != "" && cfg.S3SecretAccessKey != "",
		cfg.S3EndpointBackup != "" && cfg.S3AccessKeyIDBackup != "" && cfg.S3SecretBackup != "",
	)

	shutdownTelemetry, err := app.InitTelemetry(ctx, cfg)
	if err != nil {
		log.Fatalf("failed to initialize telemetry: %v", err)
	}
	defer func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := shutdownTelemetry(shutdownCtx); err != nil {
			log.Printf("failed to shutdown telemetry: %v", err)
		}
	}()

	worker, err := app.NewWorker(ctx, cfg)
	if err != nil {
		log.Fatalf("failed to initialize worker: %v", err)
	}
	log.Printf("worker_whatsmeow initialized worker_id=%s", cfg.WorkerID)

	errCh := make(chan error, 1)
	go func() {
		errCh <- worker.Run(ctx)
	}()

	select {
	case <-ctx.Done():
	case err := <-errCh:
		if err != nil && !errors.Is(err, context.Canceled) {
			log.Printf("worker stopped with error: %v", err)
		}
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if err := worker.Shutdown(shutdownCtx); err != nil {
		log.Printf("worker shutdown error: %v", err)
	}
}
