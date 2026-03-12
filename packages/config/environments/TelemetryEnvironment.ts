import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';

export type OtlpProtocol = 'grpc' | 'http/protobuf';

const DEFAULT_GRPC_ENDPOINT =
  'http://otel-collector-opentelemetry-collector.observability.svc.cluster.local:4317';
const DEFAULT_HTTP_ENDPOINT = 'https://otel.devunder.com';
const INTERNAL_GRPC_MATRIX_SERVICES = new Set([
  'manager',
  'public',
  'schedule',
  'schedule_api',
]);

export class TelemetryEnvironment {
  public get otelEnabled(): boolean {
    return process.env.OTEL_ENABLE !== 'false';
  }

  public get deploymentEnvironment(): string {
    return (
      process.env.OTEL_ENVIRONMENT ||
      process.env.APP_ENVIRONMENT ||
      process.env.NODE_ENV ||
      'LOCAL'
    );
  }

  public get traceSampleRate(): number {
    const rate = process.env.OTEL_TRACE_SAMPLE_RATE;
    if (!rate) {
      return 1.0;
    }

    const parsed = Number.parseFloat(rate);
    if (Number.isNaN(parsed) || parsed < 0 || parsed > 1) {
      return 1.0;
    }

    return parsed;
  }

  public get logLevel(): string {
    return process.env.OTEL_LOG_LEVEL || process.env.LOG_LEVEL || 'info';
  }

  public get serviceName(): string {
    const serviceName =
      process.env.OTEL_SERVICE_NAME ||
      process.env.npm_package_name ||
      process.env.SERVICE_NAME;

    if (!serviceName) {
      throw new InvalidConfigurationError(
        'OTEL_SERVICE_NAME is not defined and service name could not be inferred.'
      );
    }

    return serviceName;
  }

  public get resourceAttributes(): Record<string, string> {
    const base: Record<string, string> = {
      'service.name': this.serviceName,
      'deployment.environment': this.deploymentEnvironment,
      'service.namespace': 'underchat',
    };

    const raw = process.env.OTEL_RESOURCE_ATTRIBUTES;
    if (!raw) {
      return base;
    }

    const pairs = raw
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    for (const pair of pairs) {
      const [key, ...valueParts] = pair.split('=');
      const normalizedKey = key?.trim();
      const normalizedValue = valueParts.join('=').trim();

      if (normalizedKey && normalizedValue) {
        base[normalizedKey] = normalizedValue;
      }
    }

    return base;
  }

  public get otlpProtocol(): OtlpProtocol {
    const rawProtocol =
      process.env.OTEL_EXPORTER_OTLP_PROTOCOL?.trim().toLowerCase();

    if (rawProtocol === 'grpc') {
      return 'grpc';
    }

    if (
      rawProtocol === 'http/protobuf' ||
      rawProtocol === 'http' ||
      rawProtocol === 'http/json'
    ) {
      return 'http/protobuf';
    }

    return this.matrixUsesGrpc ? 'grpc' : 'http/protobuf';
  }

  public get otlpEndpoint(): string {
    const explicit = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();

    if (explicit) {
      return explicit;
    }

    if (this.otlpProtocol === 'grpc') {
      return DEFAULT_GRPC_ENDPOINT;
    }

    return DEFAULT_HTTP_ENDPOINT;
  }

  public get matrixUsesGrpc(): boolean {
    const normalizedService = this.serviceName.trim().toLowerCase();
    return INTERNAL_GRPC_MATRIX_SERVICES.has(normalizedService);
  }

  public get serviceNameForLogs(): string {
    return this.serviceName;
  }
}
