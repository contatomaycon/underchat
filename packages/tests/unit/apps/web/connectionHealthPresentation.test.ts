import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import { EWorkerType } from '@core/common/enums/EWorkerType';

const filename = resolve(
  process.cwd(),
  'apps/web/src/utils/connectionHealthPresentation.ts'
);
const transpiled = ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: filename,
}).outputText;
const loaded = { exports: {} as Record<string, unknown> };
const evaluate = new Function('require', 'module', 'exports', transpiled) as (
  requireModule: (moduleId: string) => unknown,
  module: typeof loaded,
  exports: Record<string, unknown>
) => void;

evaluate(
  (moduleId) => {
    if (moduleId === '@core/common/enums/EWorkerSessionStorage') {
      return { EWorkerSessionStorage };
    }
    if (moduleId === '@core/common/enums/EWorkerType') {
      return { EWorkerType };
    }
    throw new Error(`Unexpected connection health dependency: ${moduleId}`);
  },
  loaded,
  loaded.exports
);

const canViewConnectionHealth = loaded.exports
  .canViewConnectionHealth as (channel: {
  session_storage: EWorkerSessionStorage;
  type: { id: string; name: string | null };
}) => boolean;
const formatConnectionBytes = loaded.exports.formatConnectionBytes as (
  bytes: number,
  locale: string
) => string;
const formatConnectionDuration = loaded.exports.formatConnectionDuration as (
  seconds: number,
  locale: string
) => string;
const connectionHealthDiagnosticTranslationKey = loaded.exports
  .connectionHealthDiagnosticTranslationKey as (value: string) => string;
const formatConnectionHealthDiagnosticFallback = loaded.exports
  .formatConnectionHealthDiagnosticFallback as (value: string) => string;
const buildConnectionHealthMetricRows = loaded.exports
  .buildConnectionHealthMetricRows as (
  events: Array<{
    id: string;
    status: string;
    connected: boolean;
    authenticated: boolean;
    session_valid: boolean | null;
    recoverable: boolean;
    observed_at: string;
    reason: string | null;
    error_code: string | null;
    code: string | number | null;
    runtime_generation: number;
  }>,
  metric:
    'disconnections' | 'reconnections' | 'status_changes' | 'last_downtime'
) => Array<{
  observedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  status: string;
}>;

describe('connection health presentation', () => {
  it.each([EWorkerType.baileys, EWorkerType.wwebjs, EWorkerType.whatsmeow])(
    'shows health for the %s Postgres provider',
    (workerType) => {
      expect(
        canViewConnectionHealth({
          session_storage: EWorkerSessionStorage.postgres,
          type: { id: workerType, name: null },
        })
      ).toBe(true);
    }
  );

  it('hides health for legacy volumes and the official provider', () => {
    expect(
      canViewConnectionHealth({
        session_storage: EWorkerSessionStorage.legacy_volume,
        type: { id: EWorkerType.baileys, name: null },
      })
    ).toBe(false);
    expect(
      canViewConnectionHealth({
        session_storage: EWorkerSessionStorage.postgres,
        type: { id: EWorkerType.whatsapp, name: null },
      })
    ).toBe(false);
  });

  it('formats durations and database sizes for compact diagnostics', () => {
    expect(formatConnectionDuration(93_600, 'pt-BR')).toBe('1d 2h');
    expect(formatConnectionBytes(1_572_864, 'pt-BR')).toBe('1,5 MB');
  });

  it('normalizes diagnostic tags into translations with a readable fallback', () => {
    expect(
      connectionHealthDiagnosticTranslationKey('connection_validated')
    ).toBe('connection_health_diagnostic_connection_validated');
    expect(
      connectionHealthDiagnosticTranslationKey('ConnectionService disconnected')
    ).toBe('connection_health_diagnostic_connection_service_disconnected');
    expect(
      formatConnectionHealthDiagnosticFallback('transport_interrupted')
    ).toBe('Transport interrupted');
  });

  it('builds chronological detail rows for the clickable period metrics', () => {
    const event = (
      id: string,
      status: string,
      observedAt: string,
      connected: boolean
    ) => ({
      id,
      status,
      connected,
      authenticated: connected,
      session_valid: connected,
      recoverable: !connected,
      observed_at: observedAt,
      reason: null,
      error_code: null,
      code: 200,
      runtime_generation: 1,
    });
    const events = [
      event('4', 'online', '2026-08-16T10:08:00.000Z', true),
      event('3', 'connecting', '2026-08-16T10:05:00.000Z', false),
      event('2', 'offline', '2026-08-16T10:03:00.000Z', false),
      event('1', 'online', '2026-08-16T10:00:00.000Z', true),
    ];

    expect(
      buildConnectionHealthMetricRows(events, 'disconnections')
    ).toMatchObject([
      {
        observedAt: '2026-08-16T10:03:00.000Z',
        endedAt: '2026-08-16T10:08:00.000Z',
        durationSeconds: 300,
        status: 'offline',
      },
    ]);
    expect(
      buildConnectionHealthMetricRows(events, 'reconnections')
    ).toHaveLength(1);
    expect(
      buildConnectionHealthMetricRows(events, 'status_changes')
    ).toHaveLength(3);
    expect(
      buildConnectionHealthMetricRows(events, 'last_downtime')
    ).toMatchObject([
      {
        observedAt: '2026-08-16T10:03:00.000Z',
        endedAt: '2026-08-16T10:08:00.000Z',
        durationSeconds: 300,
      },
    ]);
  });
});
