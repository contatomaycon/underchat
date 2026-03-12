import type { App } from 'vue';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web';
import {
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ZoneContextManager } from '@opentelemetry/context-zone';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { DocumentLoadInstrumentation } from '@opentelemetry/instrumentation-document-load';
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch';
import { XMLHttpRequestInstrumentation } from '@opentelemetry/instrumentation-xml-http-request';
import { recordException } from '@/@webcore/observability';

let initialized = false;

function parseSampleRate(raw: string | undefined): number {
  if (!raw) {
    return 1;
  }

  const parsed = Number.parseFloat(raw);
  if (Number.isNaN(parsed) || parsed < 0 || parsed > 1) {
    return 1;
  }

  return parsed;
}

function normalizeCollectorUrl(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

function installGlobalErrorHandlers(app: App): void {
  const previousErrorHandler = app.config.errorHandler;

  app.config.errorHandler = (error, instance, info) => {
    recordException(error, {
      source: 'vue.errorHandler',
      info,
      component: instance?.$options?.name || 'unknown',
    });

    if (previousErrorHandler) {
      previousErrorHandler(error, instance, info);
    }
  };

  window.addEventListener('error', (event) => {
    recordException(event.error || new Error(event.message), {
      source: 'window.error',
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    recordException(event.reason, {
      source: 'window.unhandledrejection',
    });
  });
}

export default (app: App) => {
  if (initialized) {
    return;
  }

  const enabled = import.meta.env.VITE_OTEL_ENABLED !== 'false';
  if (!enabled) {
    return;
  }

  const collectorUrl = normalizeCollectorUrl(
    import.meta.env.VITE_OTEL_COLLECTOR_URL || 'https://otel.devunder.com'
  );
  const serviceName = import.meta.env.VITE_OTEL_SERVICE_NAME || 'web';
  const environment = import.meta.env.VITE_OTEL_ENVIRONMENT || 'LOCAL';
  const sampleRate = parseSampleRate(
    import.meta.env.VITE_OTEL_TRACE_SAMPLE_RATE
  );
  const exporter = new OTLPTraceExporter({
    url: `${collectorUrl}/v1/traces`,
  });

  const provider = new WebTracerProvider({
    resource: resourceFromAttributes({
      'service.name': serviceName,
      'deployment.environment': environment,
      'service.namespace': 'underchat',
    }),
    sampler: new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(sampleRate),
    }),
    spanProcessors: [new BatchSpanProcessor(exporter)],
  });

  provider.register({
    contextManager: new ZoneContextManager(),
  });

  registerInstrumentations({
    instrumentations: [
      new DocumentLoadInstrumentation(),
      new FetchInstrumentation({
        propagateTraceHeaderCorsUrls: [/.*/],
      }),
      new XMLHttpRequestInstrumentation({
        propagateTraceHeaderCorsUrls: [/.*/],
      }),
    ],
  });

  installGlobalErrorHandlers(app);
  initialized = true;
};
