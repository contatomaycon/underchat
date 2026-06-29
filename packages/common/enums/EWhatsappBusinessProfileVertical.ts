export const WHATSAPP_BUSINESS_PROFILE_VERTICALS = [
  'OTHER',
  'AUTO',
  'BEAUTY',
  'APPAREL',
  'EDU',
  'ENTERTAIN',
  'EVENT_PLAN',
  'FINANCE',
  'GROCERY',
  'GOVT',
  'HOTEL',
  'HEALTH',
  'NONPROFIT',
  'PROF_SERVICES',
  'RETAIL',
  'TRAVEL',
  'RESTAURANT',
  'ALCOHOL',
  'ONLINE_GAMBLING',
  'PHYSICAL_GAMBLING',
  'OTC_DRUGS',
  'MATRIMONY_SERVICE',
] as const;

export type WhatsappBusinessProfileVertical =
  (typeof WHATSAPP_BUSINESS_PROFILE_VERTICALS)[number];

export const isWhatsappBusinessProfileVertical = (
  value: string | null | undefined
): value is WhatsappBusinessProfileVertical =>
  typeof value === 'string' &&
  WHATSAPP_BUSINESS_PROFILE_VERTICALS.includes(
    value as WhatsappBusinessProfileVertical
  );
