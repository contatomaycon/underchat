import { inject, injectable } from 'tsyringe';
import { PasswordEncryptorService } from '@core/services/passwordEncryptor.service';

export interface WorkerExternalConnectionTokenPayload {
  account_id: string;
  worker_id: string;
  server_id?: string;
  worker_type_id?: string;
  worker_updated_at?: string;
  external_connection_revision?: number;
  iat: number;
  exp: number;
}

export interface WorkerExternalConnectionToken {
  token: string;
  expiresAt: Date;
}

export interface WorkerExternalConnectionSnapshot {
  server_id?: string | null;
  worker_type_id?: string | null;
  worker_updated_at?: string | Date | null;
  external_connection_revision?: number | null;
}

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

@injectable()
export class WorkerExternalConnectionTokenService {
  constructor(
    @inject(PasswordEncryptorService)
    private readonly passwordEncryptorService: PasswordEncryptorService
  ) {}

  create(
    accountId: string,
    workerId: string,
    snapshotOrNow:
      | Pick<
          WorkerExternalConnectionTokenPayload,
          | 'server_id'
          | 'worker_type_id'
          | 'worker_updated_at'
          | 'external_connection_revision'
        >
      | number = {},
    now = Date.now()
  ): WorkerExternalConnectionToken {
    const snapshot =
      typeof snapshotOrNow === 'number' ? undefined : snapshotOrNow;
    const issuedAt = typeof snapshotOrNow === 'number' ? snapshotOrNow : now;
    const payload: WorkerExternalConnectionTokenPayload = {
      account_id: accountId,
      worker_id: workerId,
      ...(snapshot?.server_id ? { server_id: snapshot.server_id } : {}),
      ...(snapshot?.worker_type_id
        ? { worker_type_id: snapshot.worker_type_id }
        : {}),
      ...(snapshot?.worker_updated_at
        ? { worker_updated_at: snapshot.worker_updated_at }
        : {}),
      ...(snapshot?.external_connection_revision
        ? {
            external_connection_revision: snapshot.external_connection_revision,
          }
        : {}),
      iat: issuedAt,
      exp: issuedAt + TOKEN_TTL_MS,
    };

    const encrypted = this.passwordEncryptorService.encrypt(
      JSON.stringify(payload)
    );

    return {
      token: Buffer.from(encrypted, 'utf8').toString('base64url'),
      expiresAt: new Date(payload.exp),
    };
  }

  validate(
    token: string,
    now = Date.now()
  ): WorkerExternalConnectionTokenPayload {
    const payload = this.decrypt(token);

    if (payload.exp <= now) {
      throw new Error('worker_external_connection_expired');
    }

    return payload;
  }

  validateWorkerSnapshot(
    payload: WorkerExternalConnectionTokenPayload,
    currentSnapshot: WorkerExternalConnectionSnapshot
  ): void {
    const tokenSnapshot = this.normalizeSnapshot(payload);
    const normalizedCurrentSnapshot = this.normalizeSnapshot(currentSnapshot);

    if (
      tokenSnapshot.server_id !== normalizedCurrentSnapshot.server_id ||
      tokenSnapshot.worker_type_id !==
        normalizedCurrentSnapshot.worker_type_id ||
      tokenSnapshot.external_connection_revision !==
        normalizedCurrentSnapshot.external_connection_revision
    ) {
      throw new Error('worker_external_connection_revoked');
    }
  }

  private decrypt(token: string): WorkerExternalConnectionTokenPayload {
    try {
      const encrypted = Buffer.from(token, 'base64url').toString('utf8');
      const decrypted = this.passwordEncryptorService.decrypt(encrypted);
      const payload = JSON.parse(
        decrypted
      ) as WorkerExternalConnectionTokenPayload;

      if (!this.isValidPayload(payload)) {
        throw new Error('Invalid payload');
      }

      return payload;
    } catch {
      throw new Error('worker_external_connection_invalid');
    }
  }

  private isValidPayload(
    payload: WorkerExternalConnectionTokenPayload
  ): payload is WorkerExternalConnectionTokenPayload {
    return (
      Boolean(payload) &&
      typeof payload.account_id === 'string' &&
      payload.account_id.length > 0 &&
      typeof payload.worker_id === 'string' &&
      payload.worker_id.length > 0 &&
      typeof payload.iat === 'number' &&
      Number.isFinite(payload.iat) &&
      typeof payload.exp === 'number' &&
      Number.isFinite(payload.exp) &&
      payload.exp > payload.iat &&
      this.isOptionalNonEmptyString(payload.server_id) &&
      this.isOptionalNonEmptyString(payload.worker_type_id) &&
      this.isOptionalTimestamp(payload.worker_updated_at) &&
      this.isOptionalPositiveInteger(payload.external_connection_revision)
    );
  }

  private isOptionalNonEmptyString(value: unknown): boolean {
    return (
      typeof value === 'undefined' ||
      (typeof value === 'string' && value.length > 0)
    );
  }

  private isOptionalTimestamp(value: unknown): boolean {
    return (
      typeof value === 'undefined' ||
      (typeof value === 'string' && Number.isFinite(Date.parse(value)))
    );
  }

  private isOptionalPositiveInteger(value: unknown): boolean {
    return (
      typeof value === 'undefined' ||
      (typeof value === 'number' && Number.isSafeInteger(value) && value > 0)
    );
  }

  private normalizeSnapshot(
    snapshot: WorkerExternalConnectionSnapshot
  ): Required<WorkerExternalConnectionSnapshot> {
    return {
      server_id: snapshot.server_id ?? null,
      worker_type_id: snapshot.worker_type_id ?? null,
      worker_updated_at: this.normalizeTimestamp(snapshot.worker_updated_at),
      external_connection_revision:
        typeof snapshot.external_connection_revision === 'number' &&
        Number.isSafeInteger(snapshot.external_connection_revision) &&
        snapshot.external_connection_revision > 0
          ? snapshot.external_connection_revision
          : null,
    };
  }

  private normalizeTimestamp(value?: string | Date | null): string | null {
    if (!value) {
      return null;
    }

    const timestamp =
      value instanceof Date ? value.getTime() : Date.parse(value);

    return Number.isFinite(timestamp)
      ? new Date(timestamp).toISOString()
      : null;
  }
}
