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
import { telemetryEnvironment } from '@core/config/environments';

let sdk: NodeSDK | null = null;

function normalizeOtlpHttpBaseEndpoint(endpoint: string): string {
  const withoutTrailingSlash = endpoint.endsWith('/')
    ? endpoint.slice(0, -1)
    : endpoint;

  return withoutTrailingSlash.replace(/\/v1\/(traces|metrics|logs)$/u, '');
}

function toSignalHttpUrl(
  baseEndpoint: string,
  signal: 'traces' | 'metrics' | 'logs'
): string {
  const normalizedBase = normalizeOtlpHttpBaseEndpoint(baseEndpoint);
  return `${normalizedBase}/v1/${signal}`;
}

function configureDiagLogger(): void {
  if (process.env.OTEL_DIAG_LOG_LEVEL !== 'debug') {
    return;
  }

  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
}

export function initializeSdk(): void {
  if (!telemetryEnvironment.otelEnabled) {
    return;
  }

  if (sdk) {
    return;
  }

  try {
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

    const nextSdk = new NodeSDK({
      resource: resourceFromAttributes(telemetryEnvironment.resourceAttributes),
      traceExporter,
      metricReaders: [
        new PeriodicExportingMetricReader({
          exporter: metricExporter,
          exportIntervalMillis: 15000,
        }),
      ],
      logRecordProcessors: [new BatchLogRecordProcessor(logExporter)],
      instrumentations: [
        getNodeAutoInstrumentations(),
        new PinoInstrumentation(),
      ],
    });

    nextSdk.start();
    sdk = nextSdk;

    // Use console.log instead of pino logger to avoid circular dependency
    // (this file must NOT import logger.ts to preserve instrumentation order)
    console.log(
      JSON.stringify({
        level: 'info',
        message: 'OpenTelemetry initialized',
        protocol,
        endpoint,
        service: telemetryEnvironment.serviceName,
        env: telemetryEnvironment.deploymentEnvironment,
        traceSampleRate,
      })
    );
  } catch (error) {
    sdk = null;
    console.error('Failed to initialize OpenTelemetry', error);
  }
}

export async function shutdownSdk(): Promise<void> {
  if (!sdk) {
    return;
  }

  const currentSdk = sdk;
  sdk = null;

  try {
    await currentSdk.shutdown();
  } catch (error) {
    console.error('Failed to shutdown OpenTelemetry', error);
  }
}
