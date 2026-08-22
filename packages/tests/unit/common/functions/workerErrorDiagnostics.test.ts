import {
  isRetryableWorkerRuntimeTransitionError,
  workerErrorDiagnostics,
  workerErrorFailureReason,
} from '@core/common/functions/workerErrorDiagnostics';

describe('workerErrorDiagnostics', () => {
  const secrets = {
    capability: 'capability-do-not-log-7dd432',
    dsn: 'postgres://worker:super-secret@database:5432/underchat',
    qr: '2@opaque-whatsapp-qr-do-not-log',
    session: '{"noiseKey":{"private":"session-secret"}}',
  } as const;

  it('emits only tokenized name and code without reading sensitive fields', () => {
    const error = Object.assign(new Error(Object.values(secrets).join(' ')), {
      code: '57P01',
      config: secrets.dsn,
      capability: secrets.capability,
      qrcode: secrets.qr,
      session: secrets.session,
    });
    error.name = 'DatabaseError';

    const diagnostics = workerErrorDiagnostics(error);
    const serialized = JSON.stringify(diagnostics);

    expect(diagnostics).toEqual({
      error_name: 'database_error',
      error_code: '57p01',
    });
    for (const secret of Object.values(secrets)) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).not.toContain(error.message);
  });

  it('does not stringify primitive errors or invoke metadata getters', () => {
    let getterCalls = 0;
    const error = Object.defineProperties(
      {},
      {
        code: {
          get: () => {
            getterCalls += 1;
            return secrets.capability;
          },
        },
        name: {
          get: () => {
            getterCalls += 1;
            return secrets.dsn;
          },
        },
      }
    );

    expect(workerErrorDiagnostics(error)).toEqual({
      error_name: 'unknown_error',
      error_code: 'unclassified_error',
    });
    expect(workerErrorDiagnostics(secrets.session)).toEqual({
      error_name: 'unknown_error',
      error_code: 'unclassified_error',
    });
    expect(getterCalls).toBe(0);
  });

  it('rejects unsafe name, code and reason scopes instead of rewriting them', () => {
    const error = Object.assign(new Error('hidden'), {
      code: secrets.capability,
    });
    error.name = secrets.qr;

    expect(workerErrorDiagnostics(error)).toEqual({
      error_name: 'error',
      error_code: 'unclassified_error',
    });
    expect(workerErrorFailureReason(secrets.dsn, error)).toBe(
      'worker_operation_failed'
    );
  });

  it('adds a safe error code to an application-owned failure reason', () => {
    expect(
      workerErrorFailureReason(
        'worker_database_query_failed',
        Object.assign(new Error('hidden'), { code: 'ECONNRESET' })
      )
    ).toBe('worker_database_query_failed:econnreset');
  });

  it('retains a safe causal code through bounded application wrappers', () => {
    const databaseError = Object.assign(new Error(secrets.dsn), {
      code: 'WHATSAPP_SESSION_REVISION_INVALID',
      capability: secrets.capability,
    });
    const phaseError = Object.assign(new Error(secrets.session), {
      originalError: databaseError,
    });

    expect(workerErrorDiagnostics(phaseError)).toEqual({
      error_name: 'error',
      error_code: 'whatsapp_session_revision_invalid',
    });
    expect(
      workerErrorFailureReason(
        'baileys_bootstrap_session_refresh_failed',
        phaseError
      )
    ).toBe(
      'baileys_bootstrap_session_refresh_failed:whatsapp_session_revision_invalid'
    );
  });

  it.each([
    'CODEC_INCOMPATIBLE',
    'PROJECTION_INVALID',
    'SESSION_ISOLATION_VIOLATION',
    'REVISION_INVALID',
    'LEASE_LOST',
    'FENCING_TOKEN_STALE',
  ])(
    'retains the explicit provider session error code %s through a phase wrapper',
    (code) => {
      const providerError = Object.assign(new Error(secrets.session), { code });
      const phaseError = Object.assign(new Error(secrets.qr), {
        originalError: providerError,
      });

      expect(workerErrorDiagnostics(phaseError)).toEqual({
        error_name: 'error',
        error_code: code.toLowerCase(),
      });
    }
  );

  it('does not follow cyclic wrapper metadata or invoke causal getters', () => {
    let getterCalls = 0;
    const wrapper: Record<string, unknown> = {};
    Object.defineProperties(wrapper, {
      originalError: { value: wrapper },
      cause: {
        get: () => {
          getterCalls += 1;
          return { code: 'ECONNRESET' };
        },
      },
    });

    expect(workerErrorDiagnostics(wrapper)).toEqual({
      error_name: 'unknown_error',
      error_code: 'unclassified_error',
    });
    expect(getterCalls).toBe(0);
  });

  it('recognizes only the application-owned transient runtime fence token', () => {
    expect(
      isRetryableWorkerRuntimeTransitionError(
        new Error('worker_runtime_fence_rejected')
      )
    ).toBe(true);
    expect(
      isRetryableWorkerRuntimeTransitionError(
        Object.assign(new Error('14 UNAVAILABLE'), {
          details: 'worker_runtime_fence_rejected',
        })
      )
    ).toBe(true);
    expect(
      isRetryableWorkerRuntimeTransitionError(
        new Error('grpc wrapper', {
          cause: new Error('worker_runtime_fence_rejected'),
        })
      )
    ).toBe(true);
    expect(
      isRetryableWorkerRuntimeTransitionError(
        new Error('worker_runtime_status_rejected:stale')
      )
    ).toBe(false);
  });
});
