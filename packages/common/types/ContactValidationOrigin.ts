export const CONTACT_VALIDATION_ORIGINS = {
  whatsappLookup: 'whatsapp_lookup',
  officialAssumed: 'official_assumed',
  officialInbound: 'official_inbound',
} as const;

export type ContactValidationOrigin =
  (typeof CONTACT_VALIDATION_ORIGINS)[keyof typeof CONTACT_VALIDATION_ORIGINS];
