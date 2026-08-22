// The Vue application has its own tsconfig. A runtime require lets Jest cover
// the pure helpers without adding the whole web app to the root TS project.
const {
  applyApiRequestTestResult,
  createDefaultApiRequestConfig,
  formatApiVariableTag,
  getApiRequestTestSnapshot,
  getNextApiOutputKey,
  isSafeApiResponsePath,
  normalizeApiRequestConfig,
} =
  require('../../../../apps/web/src/components/chatbot/api-request/types') as Record<
    string,
    (...args: any[]) => any
  >;

describe('chatbot API request frontend contract', () => {
  it('allocates stable prefixes and formats projected-array tags', () => {
    expect(getNextApiOutputKey(['api_1', 'api_3'])).toBe('api_2');
    expect(formatApiVariableTag('api_2', 'data.results[].name')).toBe(
      '{{ api_2.data.results.name }}'
    );
  });

  it('bounds execution settings and blocks prototype-polluting paths', () => {
    const config = normalizeApiRequestConfig({
      execution: {
        mode: 'forEach',
        concurrency: 99,
        timeoutMs: 50,
        retry: { maxAttempts: 10, initialDelayMs: 99_999 },
      },
      capture: {
        mode: 'fields',
        paths: ['data.name', 'data.__proto__.admin'],
      },
    });
    expect(config.execution).toMatchObject({
      concurrency: 3,
      timeoutMs: 1000,
      retry: { maxAttempts: 3, initialDelayMs: 5000 },
    });
    expect(config.capture.paths).toEqual(['data.name']);
    expect(isSafeApiResponsePath('constructor.prototype')).toBe(false);
  });

  it('never persists the real response preview and keeps mapping changes valid', () => {
    const tested = applyApiRequestTestResult(
      createDefaultApiRequestConfig('api_1'),
      {
        ok: true,
        statusCode: 200,
        durationMs: 12,
        headers: { 'x-token': 'preview-only' },
        bodyType: 'json',
        preview: { secret: 'must-not-be-persisted' },
        contract: [{ path: 'data.name', type: 'string' }],
        evidence: {
          proof: 'proof',
          fingerprint: 'fingerprint',
          testedAt: '2026-07-12T12:00:00.000Z',
          statusCode: 200,
          bodyType: 'json',
        },
      }
    );
    expect(JSON.stringify(tested)).not.toContain('must-not-be-persisted');
    const requestSnapshot = getApiRequestTestSnapshot(tested);
    tested.capture.paths = ['data.name'];
    expect(getApiRequestTestSnapshot(tested)).toBe(requestSnapshot);
  });
});
