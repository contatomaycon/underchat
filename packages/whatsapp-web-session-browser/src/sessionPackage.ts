import type {
  SecureConnectionTargetProvider,
  SecureSessionPackage,
} from './types';

type JsonRecord = Record<string, unknown>;

export type WwebjsCanonicalProjection = JsonRecord & {
  blockers: string[];
  complete: boolean;
  kind: 'wwebjs-canonical-session-v1';
  web_version: string;
};

export type WhatsAppWebExtractedCreds = {
  account: {
    accountSignature: string;
    accountSignatureKey: string;
    details: string;
    deviceSignature: string;
  };
  advSecretKey?: string | null;
  firstUnuploadedPreKeyId: number;
  me: {
    id: string;
    lid?: string;
    name?: string;
    username?: string;
  };
  nextPreKeyId: number;
  noiseKey: {
    private: string;
    public: string;
  };
  platform: string;
  registrationId: number;
  signedIdentityKey: {
    private: string;
    public: string;
  };
  signedPreKey: {
    keyId: number;
    keyPair: {
      private: string;
      public: string;
    };
    signature: string;
  };
};

export type WhatsAppWebAuthDump = {
  appStateSyncKeyCount: number;
  appStateVersionCount: number;
  creds: WhatsAppWebExtractedCreds;
  profile?: {
    complete: boolean;
    localStorage: Record<string, string>;
    lossyRecordCount: number;
    serializationFormat: 'wwebjs-browser-value-v1';
    signalStorage?: {
      databaseName: string;
      stores: Array<{
        autoIncrement: boolean;
        keyPath: string | string[] | null;
        name: string;
        records: Array<{
          key: unknown;
          value: unknown;
        }>;
      }>;
    };
  };
};

export type WhatsAppPageContext = {
  href: string;
  indexedDbNames: string[];
  userAgent: string;
  webVersion?: string;
};

export type SecureSessionSourceClient = {
  kind: 'chrome_extension' | 'underchat_authenticator';
  platform?: string;
  version: string;
};

const WORKER_PROVIDER_MAP: Record<string, SecureConnectionTargetProvider> = {
  '019a930d-c6f6-766d-9c84-53307d4159a1': 'baileys',
  '019a930d-c6f6-766d-9c84-62b9c3e7d1f0': 'wwebjs',
  'e80ad183-2b46-4628-9105-a036f2d28720': 'whatsmeow',
};

type BufferJsonWrapper = {
  data: string;
  type: 'Buffer';
};

export function targetProviderForWorkerType(
  workerTypeId?: string
): SecureConnectionTargetProvider {
  return workerTypeId ? (WORKER_PROVIDER_MAP[workerTypeId] ?? 'auto') : 'auto';
}

export function buildSecureSessionPackage(input: {
  authDump: WhatsAppWebAuthDump;
  pageContext: WhatsAppPageContext;
  sourceClient: SecureSessionSourceClient;
  targetProvider: SecureConnectionTargetProvider;
  wwebjsCanonicalProjection?: WwebjsCanonicalProjection;
}): SecureSessionPackage {
  if (input.targetProvider === 'wwebjs') {
    if (!input.pageContext.webVersion) {
      throw new Error(
        'Não foi possível identificar a versão exata do WhatsApp Web para importar no WWebJS.'
      );
    }
    if (!input.authDump.profile || input.authDump.profile.complete !== true) {
      const lossCount = input.authDump.profile?.lossyRecordCount ?? 0;
      throw new Error(
        `O armazenamento do WhatsApp Web contém dados que não podem ser serializados com segurança para o WWebJS (${lossCount} perdas).`
      );
    }
    if (
      !input.wwebjsCanonicalProjection ||
      input.wwebjsCanonicalProjection.kind !== 'wwebjs-canonical-session-v1' ||
      input.wwebjsCanonicalProjection.complete !== true ||
      input.wwebjsCanonicalProjection.blockers.length > 0 ||
      input.wwebjsCanonicalProjection.web_version !==
        input.pageContext.webVersion
    ) {
      const blockers = input.wwebjsCanonicalProjection?.blockers ?? [];
      throw new Error(
        `A projeção canônica do WWebJS está incompleta (${blockers.join(',') || 'canonical_projection_unavailable'}).`
      );
    }
  }

  const payload: JsonRecord = {
    [input.sourceClient.kind]: {
      ...(input.sourceClient.platform
        ? { platform: input.sourceClient.platform }
        : {}),
      version: input.sourceClient.version,
    },
    href: input.pageContext.href,
    indexed_db_names: input.pageContext.indexedDbNames,
    user_agent: input.pageContext.userAgent,
    whatsapp_web_creds: input.authDump.creds,
    whatsapp_web_session_summary: {
      app_state_sync_key_count: input.authDump.appStateSyncKeyCount,
      app_state_version_count: input.authDump.appStateVersionCount,
      has_account: Boolean(input.authDump.creds.account.accountSignatureKey),
      has_lid: Boolean(input.authDump.creds.me.lid),
      has_me: Boolean(input.authDump.creds.me.id),
      has_noise_key: Boolean(input.authDump.creds.noiseKey.private),
      has_signed_identity_key: Boolean(
        input.authDump.creds.signedIdentityKey.private
      ),
      has_signed_pre_key: Boolean(input.authDump.creds.signedPreKey.signature),
      profile_complete: input.authDump.profile?.complete === true,
      profile_lossy_record_count: input.authDump.profile?.lossyRecordCount ?? 0,
      registration_id_present: input.authDump.creds.registrationId > 0,
    },
  };

  if (input.authDump.profile) {
    payload.whatsapp_web_profile = input.authDump.profile;
  }

  if (input.wwebjsCanonicalProjection) {
    payload.wwebjs_canonical_projection = input.wwebjsCanonicalProjection;
  }

  if (input.targetProvider === 'baileys' || input.targetProvider === 'auto') {
    payload.baileys_multi_file_auth_state = {
      files: {
        'creds.json': JSON.stringify(
          createBaileysCredsFile(input.authDump.creds)
        ),
      },
      source: 'whatsapp_web_creds',
    };
  }

  return {
    account_hint: input.authDump.creds.me.id,
    created_at: new Date().toISOString(),
    format_version: 'underchat-wa-web-session-v1',
    payload,
    source: 'whatsapp_web',
    target_provider: input.targetProvider,
    web_version: input.pageContext.webVersion,
  };
}

function createBaileysCredsFile(creds: WhatsAppWebExtractedCreds): JsonRecord {
  const accountSignatureKey = base64ToBytes(creds.account.accountSignatureKey);
  const signalIdentities =
    accountSignatureKey && creds.me.lid
      ? [
          {
            identifier: {
              deviceId: 0,
              name: creds.me.lid,
            },
            identifierKey: bufferWrap(
              bytesToBase64Required(
                prefixSignalPublicKey(accountSignatureKey),
                'account signature key'
              )
            ),
          },
        ]
      : [];

  return {
    account: {
      accountSignature: bufferWrap(creds.account.accountSignature),
      accountSignatureKey: bufferWrap(creds.account.accountSignatureKey),
      details: bufferWrap(creds.account.details),
      deviceSignature: bufferWrap(creds.account.deviceSignature),
    },
    accountSettings: {
      unarchiveChats: false,
    },
    accountSyncCounter: 0,
    advSecretKey: creds.advSecretKey ?? '',
    firstUnuploadedPreKeyId: creds.firstUnuploadedPreKeyId,
    me: creds.me,
    nextPreKeyId: creds.nextPreKeyId,
    noiseKey: {
      private: bufferWrap(creds.noiseKey.private),
      public: bufferWrap(creds.noiseKey.public),
    },
    platform: creds.platform,
    processedHistoryMessages: [],
    registered: true,
    registrationId: creds.registrationId,
    signalIdentities,
    signedIdentityKey: {
      private: bufferWrap(creds.signedIdentityKey.private),
      public: bufferWrap(creds.signedIdentityKey.public),
    },
    signedPreKey: {
      keyId: creds.signedPreKey.keyId,
      keyPair: {
        private: bufferWrap(creds.signedPreKey.keyPair.private),
        public: bufferWrap(creds.signedPreKey.keyPair.public),
      },
      signature: bufferWrap(creds.signedPreKey.signature),
    },
  };
}

function base64ToBytes(value: string): Uint8Array | null {
  const normalized = value.trim().replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    return null;
  }

  try {
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

function bytesToBase64Required(
  value: Uint8Array | null,
  label: string
): string {
  if (!value) {
    throw new Error(`Não foi possível converter ${label} para base64.`);
  }

  let binary = '';
  const step = 0x8000;
  for (let index = 0; index < value.length; index += step) {
    binary += String.fromCharCode(...value.subarray(index, index + step));
  }

  return btoa(binary);
}

function prefixSignalPublicKey(value: Uint8Array): Uint8Array {
  if (value.length === 33) {
    return value;
  }

  const output = new Uint8Array(value.length + 1);
  output[0] = 5;
  output.set(value, 1);
  return output;
}

function bufferWrap(base64: string): BufferJsonWrapper {
  return {
    data: base64,
    type: 'Buffer',
  };
}
