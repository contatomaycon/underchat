import 'reflect-metadata';
import { createHmac } from 'node:crypto';
import {
  createApiRequestFingerprint,
  decryptApiRequestSecrets,
  encryptApiRequestSecrets,
  maskApiRequestSecrets,
  signApiRequestProof,
  verifyApiRequestProof,
} from '@core/common/functions/chatbotApiRequestSecurity';
import { PasswordEncryptorService } from '@core/services/passwordEncryptor.service';
import type { ApiRequestConfig } from '@core/schema/chatbot/chatbotFlow.schema';

process.env.CRYPTO_KEY_START ||= 'unit-test-key-start';
process.env.CRYPTO_KEY_END ||= 'unit-test-key-end';

const stableSerialize = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
};

const signLegacyProof = (payload: unknown): string => {
  const encoded = Buffer.from(stableSerialize(payload)).toString('base64url');
  const signature = createHmac(
    'sha256',
    `${process.env.CRYPTO_KEY_START}:${process.env.CRYPTO_KEY_END}:chatbot-api-request-proof-v1`
  )
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${signature}`;
};

const config = (): ApiRequestConfig => ({
  version: 1,
  outputKey: 'api_1',
  method: 'POST',
  url: 'https://example.com/token',
  queryParams: [],
  headers: [
    {
      id: 'header-secret',
      enabled: true,
      key: 'X-Secret',
      value: 'header-value',
      sensitive: true,
      hasValue: true,
    },
  ],
  auth: {
    type: 'bearer',
    bearer: {
      token: { id: 'bearer-token', value: 'token-value', hasValue: true },
    },
    apiKey: {
      placement: 'header',
      name: 'X-API-Key',
      value: { id: 'api-key', value: '', hasValue: false },
    },
    basic: {
      username: { id: 'basic-user', value: '', hasValue: false },
      password: { id: 'basic-password', value: '', hasValue: false },
    },
  },
  body: {
    id: 'body-secret',
    type: 'json',
    json: '{"password":"secret"}',
    raw: '',
    contentType: 'application/json',
    sensitive: true,
    hasValue: true,
    formFields: [],
    multipart: [],
  },
  execution: {
    mode: 'once',
    itemsExpression: '',
    concurrency: 1,
    failurePolicy: 'failFast',
    timeoutMs: 10000,
    retry: { maxAttempts: 2, initialDelayMs: 200 },
    idempotencyKey: 'request-key',
  },
  capture: {
    mode: 'full',
    paths: [],
    responseHeaders: [],
    contract: [{ path: 'data.id', type: 'string' }],
    availableResponseHeaders: ['content-type'],
  },
  test: { state: 'untested', evidence: null },
});

describe('chatbot API request secret security', () => {
  const encryptor = new PasswordEncryptorService();

  it('encrypts static secrets and returns only masks to the editor', () => {
    const secured = encryptApiRequestSecrets(config(), encryptor);
    expect(secured.auth.bearer.token.value).toBeUndefined();
    expect(secured.auth.bearer.token.ciphertext).toBeTruthy();
    expect(secured.headers[0]?.ciphertext).toBeTruthy();
    expect(secured.body.ciphertext).toBeTruthy();

    const masked = maskApiRequestSecrets(secured);
    expect(masked.auth.bearer.token).toEqual({
      id: 'bearer-token',
      hasValue: true,
    });
    expect(masked.headers[0]?.value).toBeUndefined();
    expect(masked.headers[0]?.ciphertext).toBeUndefined();
    expect(JSON.stringify(masked)).not.toContain('token-value');
  });

  it('preserves ciphertext by stable field id when a masked secret is saved', () => {
    const secured = encryptApiRequestSecrets(config(), encryptor);
    const masked = maskApiRequestSecrets(secured);
    const savedAgain = encryptApiRequestSecrets(masked, encryptor, secured);
    expect(savedAgain.auth.bearer.token.ciphertext).toBe(
      secured.auth.bearer.token.ciphertext
    );
    expect(
      decryptApiRequestSecrets(savedAgain, encryptor).auth.bearer.token.value
    ).toBe('token-value');
  });

  it('creates the same fingerprint across randomized encryption rounds', () => {
    const first = decryptApiRequestSecrets(
      encryptApiRequestSecrets(config(), encryptor),
      encryptor
    );
    const second = decryptApiRequestSecrets(
      encryptApiRequestSecrets(config(), encryptor),
      encryptor
    );
    expect(createApiRequestFingerprint(first, {})).toBe(
      createApiRequestFingerprint(second, {})
    );
  });

  it('keeps proof valid for selection changes and rejects request changes', () => {
    const original = config();
    const fingerprint = createApiRequestFingerprint(original, {});
    const payload = {
      accountId: 'account-1',
      chatbotId: 'chatbot-1',
      nodeId: 'node-1',
      fingerprint,
      testedAt: '2026-07-12T12:00:00.000Z',
      statusCode: 200,
      bodyType: 'json',
      contract: original.capture.contract,
      responseHeaders: original.capture.availableResponseHeaders,
    };
    const proof = signApiRequestProof(payload);
    expect(verifyApiRequestProof(proof, payload)).toBe(true);

    const selectionOnly = structuredClone(original);
    selectionOnly.capture.mode = 'fields';
    selectionOnly.capture.paths = ['data.id'];
    expect(createApiRequestFingerprint(selectionOnly, {})).toBe(fingerprint);

    const changed = structuredClone(original);
    changed.url = 'https://example.com/changed';
    expect(createApiRequestFingerprint(changed, {})).not.toBe(fingerprint);
    expect(verifyApiRequestProof(`${proof}tampered`, payload)).toBe(false);
  });

  it('accepts legacy proofs that omitted false contract flags', () => {
    const original = config();
    const fingerprint = createApiRequestFingerprint(original, {});
    const legacyPayload = {
      accountId: 'account-1',
      chatbotId: 'chatbot-1',
      nodeId: 'node-1',
      fingerprint,
      testedAt: '2026-07-12T12:00:00.000Z',
      statusCode: 200,
      bodyType: 'json',
      contract: [{ path: 'data.id', type: 'string' }],
      responseHeaders: original.capture.availableResponseHeaders,
    };
    const proof = signLegacyProof(legacyPayload);

    expect(
      verifyApiRequestProof(proof, {
        ...legacyPayload,
        contract: [
          {
            path: 'data.id',
            type: 'string',
            nullable: false,
            projectedFromArray: false,
          },
        ],
      })
    ).toBe(true);
  });

  it('keeps contract path, type and true flags strict', () => {
    const original = config();
    const fingerprint = createApiRequestFingerprint(original, {});
    const payload = {
      accountId: 'account-1',
      chatbotId: 'chatbot-1',
      nodeId: 'node-1',
      fingerprint,
      testedAt: '2026-07-12T12:00:00.000Z',
      statusCode: 200,
      bodyType: 'json',
      contract: [
        {
          path: 'data.id',
          type: 'string',
          nullable: true,
          projectedFromArray: true,
        },
      ],
      responseHeaders: original.capture.availableResponseHeaders,
    };
    const proof = signApiRequestProof(payload);
    const [contractField] = payload.contract;
    if (!contractField) {
      throw new Error('Expected proof payload to include a contract field');
    }

    expect(
      verifyApiRequestProof(proof, {
        ...payload,
        contract: [{ ...contractField, path: 'data.name' }],
      })
    ).toBe(false);
    expect(
      verifyApiRequestProof(proof, {
        ...payload,
        contract: [{ ...contractField, type: 'number' }],
      })
    ).toBe(false);
    expect(
      verifyApiRequestProof(proof, {
        ...payload,
        contract: [{ ...contractField, nullable: false }],
      })
    ).toBe(false);
    expect(
      verifyApiRequestProof(proof, {
        ...payload,
        contract: [{ ...contractField, projectedFromArray: false }],
      })
    ).toBe(false);
  });
});
