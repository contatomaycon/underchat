declare module '@wwebjs/whatsapp-web.js/src/session/CanonicalSessionBridge.js' {
  export type WwebjsCanonicalBrowserProjection = Record<string, unknown> & {
    blockers: string[];
    complete: boolean;
    kind: 'wwebjs-canonical-session-v1';
    web_version: string;
  };

  export type WwebjsCanonicalStoreProjection = Record<string, unknown> & {
    codec_kind: 'wwebjs-canonical-session-v1';
    codec_version: 1;
    complete: true;
    fingerprint_version: 'underchat-whatsapp-device-fingerprint-v2';
    module_abi: 'wwebjs-private-modules-v1';
    schema_version: 17;
    web_version: string;
  };

  export function canonicalBrowserProjectionToStore(
    projection: WwebjsCanonicalBrowserProjection
  ): WwebjsCanonicalStoreProjection;

  export function normalizeCanonicalProjection(
    projection: unknown,
    options?: {
      maxBytes?: number;
      maxRecords?: number;
      requireComplete?: boolean;
    }
  ): WwebjsCanonicalBrowserProjection;
}
