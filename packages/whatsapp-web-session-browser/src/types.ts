export type SecureConnectionTargetProvider =
  'auto' | 'baileys' | 'wwebjs' | 'whatsmeow';

export type SecureSessionPackage = {
  account_hint?: string;
  created_at: string;
  format_version: string;
  payload?: unknown;
  source: 'whatsapp_web';
  target_provider: SecureConnectionTargetProvider;
  web_version?: string;
};
