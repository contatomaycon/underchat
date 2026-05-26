package app

import (
	"context"
	"log"
	"strings"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	sdklog "go.opentelemetry.io/otel/sdk/log"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

func InitTelemetry(ctx context.Context, cfg Config) (func(context.Context) error, error) {
	if !cfg.OTELEnabled {
		return func(context.Context) error { return nil }, nil
	}

	exporter, err := otlptracehttp.New(ctx)
	if err != nil {
		return nil, err
	}

	attrs := []attribute.KeyValue{
		attribute.String("service.name", firstNonEmpty(cfg.OTELServiceName, "whatsmeow")),
		attribute.String("deployment.environment", firstNonEmpty(cfg.OTELEnvironment, "LOCAL")),
		attribute.String("worker.id", cfg.WorkerID),
		attribute.String("worker.type", "whatsmeow"),
	}
	attrs = append(attrs, parseOTELResourceAttributes(cfg.OTELResourceAttrsRaw)...)

	res, err := resource.Merge(resource.Default(), resource.NewWithAttributes("", attrs...))
	if err != nil {
		return nil, err
	}

	sampleRate := cfg.OTELTraceSampleRate
	if sampleRate < 0 || sampleRate > 1 {
		sampleRate = 1
	}
	provider := sdktrace.NewTracerProvider(
		sdktrace.WithResource(res),
		sdktrace.WithSampler(sdktrace.ParentBased(sdktrace.TraceIDRatioBased(sampleRate))),
		sdktrace.WithBatcher(exporter),
	)

	otel.SetTracerProvider(provider)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))
	log.Printf("opentelemetry initialized service=%s", firstNonEmpty(cfg.OTELServiceName, "whatsmeow"))

	shutdowns := []func(context.Context) error{provider.Shutdown}
	if cfg.MessageLifecycleDebugEnabled {
		logExporter, logErr := otlploghttp.New(ctx)
		if logErr != nil {
			log.Printf("opentelemetry logs exporter init failed; lifecycle logs will use stdout fallback: %v", logErr)
		} else {
			logProvider := sdklog.NewLoggerProvider(
				sdklog.WithResource(res),
				sdklog.WithProcessor(sdklog.NewBatchProcessor(logExporter)),
			)
			configureMessageLifecycleLoggerProvider(logProvider)
			shutdowns = append(shutdowns, logProvider.Shutdown)
			log.Printf("opentelemetry logs initialized service=%s", firstNonEmpty(cfg.OTELServiceName, "whatsmeow"))
		}
	}

	return func(shutdownCtx context.Context) error {
		var firstErr error
		for _, shutdown := range shutdowns {
			if err := shutdown(shutdownCtx); err != nil && firstErr == nil {
				firstErr = err
			}
		}
		return firstErr
	}, nil
}

func parseOTELResourceAttributes(raw string) []attribute.KeyValue {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	attrs := make([]attribute.KeyValue, 0, len(parts))
	for _, part := range parts {
		key, value, ok := strings.Cut(part, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		if key == "" {
			continue
		}
		attrs = append(attrs, attribute.String(key, value))
	}
	return attrs
}
