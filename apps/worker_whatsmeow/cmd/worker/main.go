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
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	cfg, err := app.LoadConfig()
	if err != nil {
		log.Fatalf("invalid config: %v", err)
	}

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
