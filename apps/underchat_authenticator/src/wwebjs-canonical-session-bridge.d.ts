declare module '@wwebjs/whatsapp-web.js/src/session/CanonicalSessionBridge.js' {
  export type WwebjsCanonicalBrowserProjection = Record<string, unknown> & {
    blockers: string[];
    complete: boolean;
    kind: 'wwebjs-canonical-session-v1';
    web_version: string;
  };

  export function exportCanonicalSessionProjection(options: {
    capturedAdvSecret?: string | null;
    maxBytes: number;
    maxRecords: number;
  }): Promise<WwebjsCanonicalBrowserProjection>;
}
