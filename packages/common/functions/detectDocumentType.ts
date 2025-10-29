import { ETypeSanetize } from '../enums/ETypeSanetize';

export function detectDocumentType(value: string): ETypeSanetize {
  const cleaned = value.replace(/\D/g, '');

  if (/^\d{11}$/.test(cleaned) || /^\d{14}$/.test(cleaned))
    return ETypeSanetize.document;
  if (/^\d{10,11}$/.test(cleaned)) return ETypeSanetize.phone;
  if (/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(value))
    return ETypeSanetize.email;

  return ETypeSanetize.other;
}
