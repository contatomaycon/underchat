export function normalizePhoneToJid(
  phone: string | null | undefined,
  phoneDdi: string | null | undefined = '55'
): string | undefined {
  if (!phone) return undefined;

  const ddiDigits = phoneDdi?.replaceAll(/\D/g, '') ?? '';
  const ddi = ddiDigits || '55';
  const phoneNumber = phone.replaceAll(/\D/g, '');

  if (!phoneNumber) return undefined;

  const fullNumber = `${ddi}${phoneNumber}`;
  return `${fullNumber}@s.whatsapp.net`;
}
