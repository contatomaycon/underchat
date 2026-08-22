import fs from 'node:fs';
import path from 'node:path';

import {
  buildSecureSessionPackage,
  targetProviderForWorkerType,
  type WhatsAppWebAuthDump,
  type WwebjsCanonicalProjection,
} from '@underchat/whatsapp-web-session-browser';

const authenticatorSource = fs.readFileSync(
  path.resolve('apps/underchat_authenticator/src/main/index.ts'),
  'utf8'
);

const base64 = (size: number, fill: number): string =>
  Buffer.alloc(size, fill).toString('base64');

function authDump(): WhatsAppWebAuthDump {
  return {
    appStateSyncKeyCount: 5,
    appStateVersionCount: 5,
    creds: {
      account: {
        accountSignature: base64(64, 1),
        accountSignatureKey: base64(32, 2),
        details: base64(20, 3),
        deviceSignature: base64(64, 4),
      },
      advSecretKey: base64(32, 5),
      firstUnuploadedPreKeyId: 42,
      me: {
        id: '556199999999:7@s.whatsapp.net',
        lid: '100000000000001:7@lid',
        name: 'Underchat',
      },
      nextPreKeyId: 42,
      noiseKey: {
        private: base64(32, 6),
        public: base64(32, 7),
      },
      platform: 'web',
      registrationId: 12345,
      signedIdentityKey: {
        private: base64(32, 8),
        public: base64(32, 9),
      },
      signedPreKey: {
        keyId: 41,
        keyPair: {
          private: base64(32, 10),
          public: base64(32, 11),
        },
        signature: base64(64, 12),
      },
    },
    profile: {
      complete: true,
      localStorage: {},
      lossyRecordCount: 0,
      serializationFormat: 'wwebjs-browser-value-v1',
      signalStorage: {
        databaseName: 'signal-storage',
        stores: [],
      },
    },
  };
}

const pageContext = {
  href: 'https://web.whatsapp.com/',
  indexedDbNames: ['signal-storage'],
  userAgent: 'Google Chrome',
  webVersion: '2.3000.1030198027',
};

const sourceClient = {
  kind: 'underchat_authenticator' as const,
  platform: 'linux',
  version: '1.0.2',
};

const canonicalProjection: WwebjsCanonicalProjection = {
  blockers: [],
  complete: true,
  kind: 'wwebjs-canonical-session-v1',
  web_version: pageContext.webVersion,
};

describe('Underchat Authenticator secure session packages', () => {
  it('uses the same worker mapping and shared browser extractors as the Chrome extension', () => {
    expect(
      targetProviderForWorkerType('019a930d-c6f6-766d-9c84-53307d4159a1')
    ).toBe('baileys');
    expect(
      targetProviderForWorkerType('019a930d-c6f6-766d-9c84-62b9c3e7d1f0')
    ).toBe('wwebjs');
    expect(
      targetProviderForWorkerType('e80ad183-2b46-4628-9105-a036f2d28720')
    ).toBe('whatsmeow');
    expect(authenticatorSource).toContain('extractWhatsAppWebAuthDump');
    expect(authenticatorSource).toContain('readWhatsAppPageContext');
    expect(authenticatorSource).toContain('readWhatsAppReadiness');
    expect(authenticatorSource).toContain('targetProviderForWorkerType');
    expect(authenticatorSource).not.toContain(
      'CONTROLLED_BROWSER_PROVIDER_MAP'
    );
    expect(authenticatorSource).not.toContain(
      'EXTRACT_WHATSAPP_WEB_AUTH_DUMP_SCRIPT'
    );
  });

  it('builds the Baileys auth state with the canonical companion identity', () => {
    const result = buildSecureSessionPackage({
      authDump: authDump(),
      pageContext,
      sourceClient,
      targetProvider: 'baileys',
    });
    const payload = result.payload as Record<string, unknown>;
    const baileys = payload.baileys_multi_file_auth_state as {
      files: Record<string, string>;
    };
    const creds = JSON.parse(baileys.files['creds.json']) as {
      signalIdentities: unknown[];
    };

    expect(result.target_provider).toBe('baileys');
    expect(payload.whatsapp_web_creds).toBeDefined();
    expect(creds.signalIdentities).toHaveLength(1);
  });

  it('builds a WhatsMeow package from the same complete WhatsApp Web credentials', () => {
    const result = buildSecureSessionPackage({
      authDump: authDump(),
      pageContext,
      sourceClient,
      targetProvider: 'whatsmeow',
    });
    const payload = result.payload as Record<string, unknown>;

    expect(result.target_provider).toBe('whatsmeow');
    expect(payload.whatsapp_web_creds).toBeDefined();
    expect(payload.baileys_multi_file_auth_state).toBeUndefined();
    expect(payload.underchat_authenticator).toEqual({
      platform: 'linux',
      version: '1.0.2',
    });
  });

  it('builds WWebJS with lossless browser profile and canonical projection', () => {
    const result = buildSecureSessionPackage({
      authDump: authDump(),
      pageContext,
      sourceClient,
      targetProvider: 'wwebjs',
      wwebjsCanonicalProjection: canonicalProjection,
    });
    const payload = result.payload as Record<string, unknown>;

    expect(result.target_provider).toBe('wwebjs');
    expect(payload.whatsapp_web_profile).toBeDefined();
    expect(payload.wwebjs_canonical_projection).toBe(canonicalProjection);
    expect(payload.baileys_multi_file_auth_state).toBeUndefined();
  });

  it('fails closed when WWebJS canonical material is incomplete', () => {
    expect(() =>
      buildSecureSessionPackage({
        authDump: authDump(),
        pageContext,
        sourceClient,
        targetProvider: 'wwebjs',
        wwebjsCanonicalProjection: {
          ...canonicalProjection,
          blockers: ['device.missing'],
          complete: false,
        },
      })
    ).toThrow('A projeção canônica do WWebJS está incompleta');
  });
});
