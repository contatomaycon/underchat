import { inject, injectable } from 'tsyringe';
import { PasswordEncryptorService } from '@core/services/passwordEncryptor.service';

export interface WorkerExternalConnectionTokenPayload {
  account_id: string;
  worker_id: string;
  iat: number;
  exp: number;
}

export interface WorkerExternalConnectionToken {
  token: string;
  expiresAt: Date;
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
    now = Date.now()
  ): WorkerExternalConnectionToken {
    const payload: WorkerExternalConnectionTokenPayload = {
      account_id: accountId,
      worker_id: workerId,
      iat: now,
      exp: now + TOKEN_TTL_MS,
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
      payload.exp > payload.iat
    );
  }
}
