import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { generalEnvironment } from '@core/config/environments';
import type {
  ApiRequestConfig,
  ApiRequestMultipartPart,
  ApiRequestProtectedValue,
} from '@core/schema/chatbot/chatbotFlow.schema';
import { PasswordEncryptorService } from '@core/services/passwordEncryptor.service';

const clone = <T>(value: T): T => structuredClone(value);

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

const secretValue = (
  current: ApiRequestProtectedValue,
  previous?: ApiRequestProtectedValue
): string | null => {
  if (typeof current.value === 'string' && current.value.length > 0) {
    return current.value;
  }
  if (current.hasValue && previous?.ciphertext) {
    return previous.ciphertext;
  }
  return null;
};

const protectValue = (
  current: ApiRequestProtectedValue,
  previous: ApiRequestProtectedValue | undefined,
  encryptor: PasswordEncryptorService
): void => {
  const selected = secretValue(current, previous);
  if (!selected) {
    delete current.value;
    delete current.ciphertext;
    current.hasValue = false;
    return;
  }

  current.ciphertext =
    selected === previous?.ciphertext ? selected : encryptor.encrypt(selected);
  delete current.value;
  current.hasValue = true;
};

type ProtectableValue = ApiRequestProtectedValue & { sensitive: boolean };

const protectKeyValue = (
  current: ProtectableValue,
  previous: ProtectableValue | undefined,
  encryptor: PasswordEncryptorService
): void => {
  if (!current.sensitive) {
    delete current.ciphertext;
    current.hasValue = Boolean(current.value);
    return;
  }
  protectValue(current, previous, encryptor);
};

const protectMultipartPart = (
  current: ApiRequestMultipartPart,
  previous: ApiRequestMultipartPart | undefined,
  encryptor: PasswordEncryptorService
): void => protectKeyValue(current, previous, encryptor);

const findById = <T extends { id: string }>(
  values: readonly T[] | undefined,
  id: string
): T | undefined => values?.find((value) => value.id === id);

export const encryptApiRequestSecrets = (
  config: ApiRequestConfig,
  encryptor: PasswordEncryptorService,
  previous?: ApiRequestConfig
): ApiRequestConfig => {
  const next = clone(config);

  protectValue(next.auth.bearer.token, previous?.auth.bearer.token, encryptor);
  protectValue(next.auth.apiKey.value, previous?.auth.apiKey.value, encryptor);
  protectValue(
    next.auth.basic.username,
    previous?.auth.basic.username,
    encryptor
  );
  protectValue(
    next.auth.basic.password,
    previous?.auth.basic.password,
    encryptor
  );

  for (const entry of next.queryParams) {
    protectKeyValue(
      entry,
      findById(previous?.queryParams, entry.id),
      encryptor
    );
  }
  for (const entry of next.headers) {
    protectKeyValue(entry, findById(previous?.headers, entry.id), encryptor);
  }
  for (const part of next.body.multipart) {
    protectMultipartPart(
      part,
      findById(previous?.body.multipart, part.id),
      encryptor
    );
  }
  for (const entry of next.body.formFields) {
    protectKeyValue(
      entry,
      findById(previous?.body.formFields, entry.id),
      encryptor
    );
  }

  if (next.body.sensitive && ['json', 'raw'].includes(next.body.type)) {
    const value = next.body.type === 'json' ? next.body.json : next.body.raw;
    if (typeof value === 'string' && value.length > 0) {
      next.body.ciphertext = encryptor.encrypt(value);
      next.body.hasValue = true;
    } else if (
      next.body.hasValue &&
      previous?.body.ciphertext &&
      previous.body.id === next.body.id
    ) {
      next.body.ciphertext = previous.body.ciphertext;
      next.body.hasValue = true;
    } else {
      delete next.body.ciphertext;
      next.body.hasValue = false;
    }
    next.body.json = '';
    next.body.raw = '';
  } else {
    delete next.body.ciphertext;
    next.body.hasValue = Boolean(next.body.json || next.body.raw);
  }

  return next;
};

const revealValue = (
  value: ApiRequestProtectedValue,
  encryptor: PasswordEncryptorService
): void => {
  if (value.ciphertext) value.value = encryptor.decrypt(value.ciphertext);
  delete value.ciphertext;
};

export const decryptApiRequestSecrets = (
  config: ApiRequestConfig,
  encryptor: PasswordEncryptorService
): ApiRequestConfig => {
  const next = clone(config);
  revealValue(next.auth.bearer.token, encryptor);
  revealValue(next.auth.apiKey.value, encryptor);
  revealValue(next.auth.basic.username, encryptor);
  revealValue(next.auth.basic.password, encryptor);
  for (const entry of [
    ...next.queryParams,
    ...next.headers,
    ...next.body.formFields,
    ...next.body.multipart,
  ]) {
    if (entry.ciphertext) entry.value = encryptor.decrypt(entry.ciphertext);
    delete entry.ciphertext;
  }
  if (next.body.ciphertext) {
    const value = encryptor.decrypt(next.body.ciphertext);
    if (next.body.type === 'json') next.body.json = value;
    if (next.body.type === 'raw') next.body.raw = value;
  }
  delete next.body.ciphertext;
  return next;
};

const maskValue = (value: ApiRequestProtectedValue): void => {
  value.hasValue = Boolean(value.ciphertext || value.value);
  delete value.value;
  delete value.ciphertext;
};

export const maskApiRequestSecrets = (
  config: ApiRequestConfig
): ApiRequestConfig => {
  const next = clone(config);
  maskValue(next.auth.bearer.token);
  maskValue(next.auth.apiKey.value);
  maskValue(next.auth.basic.username);
  maskValue(next.auth.basic.password);
  for (const entry of [
    ...next.queryParams,
    ...next.headers,
    ...next.body.formFields,
    ...next.body.multipart,
  ]) {
    entry.hasValue = Boolean(entry.ciphertext || entry.value);
    if (entry.sensitive) delete entry.value;
    delete entry.ciphertext;
  }
  next.body.hasValue = Boolean(
    next.body.ciphertext || next.body.json || next.body.raw
  );
  if (next.body.sensitive) {
    next.body.json = '';
    next.body.raw = '';
  }
  delete next.body.ciphertext;
  return next;
};

const fingerprintConfig = (config: ApiRequestConfig): unknown => ({
  version: config.version,
  outputKey: config.outputKey,
  method: config.method,
  url: config.url,
  queryParams: config.queryParams,
  headers: config.headers,
  auth: config.auth,
  body: config.body,
  execution: config.execution,
});

/** Selection-only changes are intentionally excluded from the fingerprint. */
export const createApiRequestFingerprint = (
  config: ApiRequestConfig,
  upstreamContracts: unknown = null
): string =>
  createHash('sha256')
    .update(
      stableSerialize({
        request: fingerprintConfig(config),
        upstreamContracts,
      })
    )
    .digest('hex');

export interface ApiRequestProofPayload {
  accountId: string;
  chatbotId: string;
  nodeId: string;
  fingerprint: string;
  testedAt: string;
  statusCode: number;
  bodyType: string;
  contract: unknown;
  responseHeaders: readonly string[];
}

const canonicalizeProofContract = (contract: unknown): unknown => {
  if (!Array.isArray(contract)) return contract;

  return contract.map((field) => {
    if (!field || typeof field !== 'object' || Array.isArray(field)) {
      return field;
    }

    const record = field as Record<string, unknown>;
    return {
      ...record,
      nullable: record.nullable === true,
      projectedFromArray: record.projectedFromArray === true,
    };
  });
};

const canonicalizeProofPayload = (payload: unknown): unknown => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload;
  }

  const record = payload as Record<string, unknown>;
  return {
    ...record,
    contract: canonicalizeProofContract(record.contract),
  };
};

const proofSecret = (): string =>
  `${generalEnvironment.cryptoKeyStart}:${generalEnvironment.cryptoKeyEnd}:chatbot-api-request-proof-v1`;

export const signApiRequestProof = (
  payload: ApiRequestProofPayload
): string => {
  const encoded = Buffer.from(
    stableSerialize(canonicalizeProofPayload(payload))
  ).toString('base64url');
  const signature = createHmac('sha256', proofSecret())
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${signature}`;
};

export const verifyApiRequestProof = (
  proof: string,
  expected: ApiRequestProofPayload
): boolean => {
  const [encoded, providedSignature, extra] = proof.split('.');
  if (!encoded || !providedSignature || extra) return false;
  const expectedSignature = createHmac('sha256', proofSecret())
    .update(encoded)
    .digest('base64url');
  const left = Buffer.from(providedSignature);
  const right = Buffer.from(expectedSignature);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return false;
  }
  try {
    const decoded = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8')
    );
    return (
      stableSerialize(canonicalizeProofPayload(decoded)) ===
      stableSerialize(canonicalizeProofPayload(expected))
    );
  } catch {
    return false;
  }
};

export const hashApiRequestSecret = (value: string): string =>
  createHash('sha256').update(value).digest('hex');
