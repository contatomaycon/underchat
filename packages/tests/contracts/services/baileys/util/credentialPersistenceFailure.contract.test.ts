import { baileysCredentialPersistenceDiagnostics } from '@core/services/baileys/util/credentialPersistenceFailure';

describe('Baileys credential persistence diagnostics', () => {
  it('preserves native and PostgreSQL codes while classifying an allowlisted message', () => {
    const postgresError = Object.assign(
      new Error('whatsapp session changed during pairing finalization'),
      { code: '40001' }
    );
    const error = Object.assign(new Error('native persistence failed'), {
      name: 'BaileysSessionFenceError',
      code: 'BAILEYS_NATIVE_CREDENTIALS_PERSISTENCE_FAILED',
      cause: postgresError,
    });

    expect(baileysCredentialPersistenceDiagnostics(error)).toEqual({
      error_name: 'baileys_session_fence_error',
      error_code: '40001',
      native_error_code: 'baileys_native_credentials_persistence_failed',
      postgres_error_code: 'sqlstate_40001',
      postgres_message_error_code:
        'whatsapp_session_changed_during_pairing_finalization',
    });
  });

  it('falls back to SQLSTATE classification without exposing unknown text or metadata', () => {
    const secret = 'postgres://runtime:capability@database/session-private';
    const error = Object.assign(new Error(`unexpected failure ${secret}`), {
      code: '40001',
      detail: secret,
      jid: '5511999999999@s.whatsapp.net',
    });

    const diagnostics = baileysCredentialPersistenceDiagnostics(error);

    expect(diagnostics).toEqual({
      error_name: 'error',
      error_code: '40001',
      native_error_code: 'native_error_code_unavailable',
      postgres_error_code: 'sqlstate_40001',
      postgres_message_error_code: 'postgres_serialization_failure',
    });
    expect(JSON.stringify(diagnostics)).not.toContain(secret);
    expect(JSON.stringify(diagnostics)).not.toContain('5511999999999');
  });

  it('does not invoke hostile accessors while walking the causal chain', () => {
    const error = Object.create(null) as Record<string, unknown>;
    for (const property of ['message', 'code', 'cause']) {
      Object.defineProperty(error, property, {
        get: () => {
          throw new Error('must not be invoked');
        },
      });
    }

    expect(baileysCredentialPersistenceDiagnostics(error)).toEqual({
      error_name: 'unknown_error',
      error_code: 'unclassified_error',
      native_error_code: 'native_error_code_unavailable',
      postgres_error_code: 'postgres_sqlstate_unavailable',
      postgres_message_error_code: 'persistence_error_message_redacted',
    });
  });
});
