import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPLogExporter as OTLPGrpcLogExporter } from '@opentelemetry/exporter-logs-otlp-grpc';
import { OTLPLogExporter as OTLPHttpLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPMetricExporter as OTLPGrpcMetricExporter } from '@opentelemetry/exporter-metrics-otlp-grpc';
import { OTLPMetricExporter as OTLPHttpMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter as OTLPGrpcTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { OTLPTraceExporter as OTLPHttpTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { incrementCounter, recordHistogram } from './observability';
import { setupErrorHandlers } from './errorHandlers';
import { logger } from './logger';
import { telemetryEnvironment } from '@core/config/environments';

let sdk: NodeSDK | null = null;
let startupPromise: Promise<void> | null = null;

function toSignalHttpUrl(
  baseEndpoint: string,
  signal: 'traces' | 'metrics' | 'logs'
): string {
  const normalized = baseEndpoint.endsWith('/')
    ? baseEndpoint.slice(0, -1)
    : baseEndpoint;

  if (normalized.endsWith(`/v1/${signal}`)) {
    return normalized;
  }

  return `${normalized}/v1/${signal}`;
}

function configureDiagLogger(): void {
  if (process.env.OTEL_DIAG_LOG_LEVEL !== 'debug') {
    return;
  }

  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
}

async function initializeObservability(): Promise<void> {
  if (!telemetryEnvironment.otelEnabled) {
    return;
  }

  if (startupPromise) {
    return startupPromise;
  }

  startupPromise = (async () => {
    if (sdk) {
      return;
    }

    configureDiagLogger();

    const protocol = telemetryEnvironment.otlpProtocol;
    const endpoint = telemetryEnvironment.otlpEndpoint;
    const traceSampleRate = telemetryEnvironment.traceSampleRate;

    if (!process.env.OTEL_TRACES_SAMPLER) {
      process.env.OTEL_TRACES_SAMPLER = 'parentbased_traceidratio';
    }
    if (!process.env.OTEL_TRACES_SAMPLER_ARG) {
      process.env.OTEL_TRACES_SAMPLER_ARG = String(traceSampleRate);
    }

    const traceExporter =
      protocol === 'grpc'
        ? new OTLPGrpcTraceExporter({ url: endpoint })
        : new OTLPHttpTraceExporter({
            url: toSignalHttpUrl(endpoint, 'traces'),
          });

    const metricExporter =
      protocol === 'grpc'
        ? new OTLPGrpcMetricExporter({ url: endpoint })
        : new OTLPHttpMetricExporter({
            url: toSignalHttpUrl(endpoint, 'metrics'),
          });

    const logExporter =
      protocol === 'grpc'
        ? new OTLPGrpcLogExporter({ url: endpoint })
        : new OTLPHttpLogExporter({
            url: toSignalHttpUrl(endpoint, 'logs'),
          });

    sdk = new NodeSDK({
      resource: resourceFromAttributes(telemetryEnvironment.resourceAttributes),
      traceExporter,
      metricReader: new PeriodicExportingMetricReader({
        exporter: metricExporter,
        exportIntervalMillis: 15000,
      }),
      logRecordProcessors: [new BatchLogRecordProcessor(logExporter)],
      instrumentations: [
        getNodeAutoInstrumentations(),
        new PinoInstrumentation(),
      ],
    });

    await sdk.start();

    logger.info(
      {
        protocol,
        endpoint,
        service: telemetryEnvironment.serviceName,
        env: telemetryEnvironment.deploymentEnvironment,
        traceSampleRate,
      },
      'OpenTelemetry initialized'
    );
  })().catch((error) => {
    logger.error(
      {
        err: error,
      },
      'Failed to initialize OpenTelemetry'
    );
  });

  return startupPromise;
}

async function shutdownObservability(): Promise<void> {
  if (!sdk) {
    return;
  }

  const currentSdk = sdk;
  sdk = null;
  startupPromise = null;

  try {
    await currentSdk.shutdown();
  } catch (error) {
    logger.error(
      {
        err: error,
      },
      'Failed to shutdown OpenTelemetry'
    );
  }
}

async function telemetryPlugin(fastify: FastifyInstance): Promise<void> {
  setupErrorHandlers();
  await initializeObservability();

  const requestDurations = new WeakMap<FastifyRequest, number>();

  fastify.addHook('onRequest', async (request) => {
    requestDurations.set(request, Date.now());

    request.log = logger.child({
      requestId: request.id,
      method: request.method,
      url: request.url,
    });
  });

  fastify.addHook('onSend', async (request, reply, payload: unknown) => {
    const startTime = requestDurations.get(request);
    if (startTime) {
      const duration = Date.now() - startTime;

      request.log.info(
        {
          service: telemetryEnvironment.serviceName,
          statusCode: reply.statusCode,
          duration,
        },
        'Request completed'
      );

      incrementCounter('http.server.requests.total', 1, {
        service: telemetryEnvironment.serviceName,
        http_method: request.method,
        http_route: request.routeOptions.url || request.url,
        http_status_code: reply.statusCode,
      });

      recordHistogram('http.server.requests.duration.ms', duration, {
        service: telemetryEnvironment.serviceName,
        http_method: request.method,
        http_route: request.routeOptions.url || request.url,
        http_status_code: reply.statusCode,
      });
    }

    return payload;
  });

  fastify.addHook('onClose', async () => {
    await shutdownObservability();
  });

  fastify.decorate('logger', logger);
}

export default fp(telemetryPlugin, {
  name: 'telemetry',
});

declare module 'fastify' {
  interface FastifyInstance {
    logger: typeof logger;
  }
}
