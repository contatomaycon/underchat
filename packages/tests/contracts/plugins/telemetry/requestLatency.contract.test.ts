import {
  createRequestLatencyContext,
  measureRequestLatencyStage,
  recordRequestLatencyStage,
  runWithRequestLatencyContext,
} from '@core/plugins/telemetry/requestLatency';

describe('request latency telemetry context', () => {
  it('records sanitized request stages in the active context', () => {
    const context = createRequestLatencyContext();

    runWithRequestLatencyContext(context, () => {
      recordRequestLatencyStage('auth.jwt_verify', 12.7, {
        cache_hit: true,
        object_value: { nested: 'value' },
      });
    });

    expect(context.stages).toEqual([
      expect.objectContaining({
        name: 'auth.jwt_verify',
        duration_ms: 13,
        ok: true,
        cache_hit: true,
        object_value: '[object Object]',
      }),
    ]);
  });

  it('records failed measured stages and rethrows the original error', async () => {
    const context = createRequestLatencyContext();

    await expect(
      runWithRequestLatencyContext(context, () =>
        measureRequestLatencyStage('elastic.select', async () => {
          throw new Error('timeout exceeded');
        })
      )
    ).rejects.toThrow('timeout exceeded');

    expect(context.stages).toEqual([
      expect.objectContaining({
        name: 'elastic.select',
        ok: false,
        error: 'timeout exceeded',
      }),
    ]);
  });
});
