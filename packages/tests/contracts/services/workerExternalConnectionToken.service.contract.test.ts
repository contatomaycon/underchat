import 'reflect-metadata';
import { PasswordEncryptorService } from '@core/services/passwordEncryptor.service';
import { WorkerExternalConnectionTokenService } from '@core/services/workerExternalConnectionToken.service';

describe('WorkerExternalConnectionTokenService', () => {
  function makeSut() {
    return new WorkerExternalConnectionTokenService(
      new PasswordEncryptorService()
    );
  }

  it('creates a base64url encrypted token and validates the payload', () => {
    const sut = makeSut();
    const now = 1_700_000_000_000;
    const result = sut.create('account-1', 'worker-1', now);

    expect(result.token).not.toContain(':');
    expect(result.expiresAt.toISOString()).toBe(
      new Date(now + 24 * 60 * 60 * 1000).toISOString()
    );

    expect(sut.validate(result.token, now)).toEqual({
      account_id: 'account-1',
      worker_id: 'worker-1',
      iat: now,
      exp: now + 24 * 60 * 60 * 1000,
    });
  });

  it('stores optional worker snapshot fields in new tokens', () => {
    const sut = makeSut();
    const now = 1_700_000_000_000;
    const result = sut.create(
      'account-1',
      'worker-1',
      {
        server_id: 'server-1',
        worker_type_id: 'worker-type-1',
        worker_updated_at: '2026-06-03T12:00:03.000Z',
        external_connection_revision: 7,
      },
      now
    );

    expect(sut.validate(result.token, now)).toEqual({
      account_id: 'account-1',
      worker_id: 'worker-1',
      server_id: 'server-1',
      worker_type_id: 'worker-type-1',
      worker_updated_at: '2026-06-03T12:00:03.000Z',
      external_connection_revision: 7,
      iat: now,
      exp: now + 24 * 60 * 60 * 1000,
    });
  });

  it('accepts only the worker snapshot captured by the token', () => {
    const sut = makeSut();
    const now = 1_700_000_000_000;
    const token = sut.create(
      'account-1',
      'worker-1',
      {
        server_id: 'server-1',
        worker_type_id: 'worker-type-1',
        worker_updated_at: '2026-06-03T12:00:03.000Z',
        external_connection_revision: 7,
      },
      now
    ).token;
    const payload = sut.validate(token, now);

    expect(() =>
      sut.validateWorkerSnapshot(payload, {
        server_id: 'server-1',
        worker_type_id: 'worker-type-1',
        worker_updated_at: new Date('2026-06-03T12:00:03.000Z'),
        external_connection_revision: 7,
      })
    ).not.toThrow();

    expect(() =>
      sut.validateWorkerSnapshot(payload, {
        server_id: 'server-1',
        worker_type_id: 'worker-type-1',
        worker_updated_at: '2026-06-03T12:30:00.000Z',
        external_connection_revision: 7,
      })
    ).not.toThrow();

    const staleSnapshots = [
      {
        server_id: 'server-2',
        worker_type_id: 'worker-type-1',
        worker_updated_at: '2026-06-03T12:00:03.000Z',
        external_connection_revision: 7,
      },
      {
        server_id: 'server-1',
        worker_type_id: 'worker-type-2',
        worker_updated_at: '2026-06-03T12:00:03.000Z',
        external_connection_revision: 7,
      },
      {
        server_id: 'server-1',
        worker_type_id: 'worker-type-1',
        worker_updated_at: '2026-06-03T12:00:03.000Z',
        external_connection_revision: 8,
      },
    ];

    for (const staleSnapshot of staleSnapshots) {
      expect(() => sut.validateWorkerSnapshot(payload, staleSnapshot)).toThrow(
        'worker_external_connection_revoked'
      );
    }
  });

  it('revokes legacy tokens without a worker snapshot', () => {
    const sut = makeSut();
    const now = 1_700_000_000_000;
    const token = sut.create('account-1', 'worker-1', now).token;
    const payload = sut.validate(token, now);

    expect(() =>
      sut.validateWorkerSnapshot(payload, {
        server_id: 'server-1',
        worker_type_id: 'worker-type-1',
        worker_updated_at: '2026-06-03T12:00:03.000Z',
        external_connection_revision: 1,
      })
    ).toThrow('worker_external_connection_revoked');
  });

  it('rejects expired tokens', () => {
    const sut = makeSut();
    const result = sut.create('account-1', 'worker-1', 1_700_000_000_000);

    expect(() =>
      sut.validate(result.token, 1_700_000_000_000 + 24 * 60 * 60 * 1000 + 1)
    ).toThrow('worker_external_connection_expired');
  });

  it('rejects tampered tokens', () => {
    const sut = makeSut();
    const result = sut.create('account-1', 'worker-1', 1_700_000_000_000);
    const encrypted = Buffer.from(result.token, 'base64url').toString('utf8');
    const [iv = '', authTag = '', cipherText = ''] = encrypted.split(':');
    const index = Math.floor(cipherText.length / 2);
    const replacement = cipherText[index] === 'a' ? 'b' : 'a';
    const tamperedCipherText = `${cipherText.slice(0, index)}${replacement}${cipherText.slice(index + 1)}`;
    const tampered = Buffer.from(
      `${iv}:${authTag}:${tamperedCipherText}`,
      'utf8'
    ).toString('base64url');

    expect(() => sut.validate(tampered, 1_700_000_000_000)).toThrow(
      'worker_external_connection_invalid'
    );
  });
});
