import { formatDateTime } from '@core/common/functions/formatDateTime';
import { formatPhoneBR } from '@core/common/functions/formatPhoneBR';
import { formatCnpj, normalizeCnpj } from '@core/common/functions/validateCnpj';
import type { ChatbotUnderchatLookupOutput } from '@core/common/interfaces/IChatbotUnderchatLookup';

const STATUS_LABELS: Readonly<Record<string, string>> = {
  active: 'Ativo',
  ativo: 'Ativo',
  inactive: 'Inativo',
  inativo: 'Inativo',
  blocked: 'Bloqueado',
  bloqueado: 'Bloqueado',
  bloqueados: 'Bloqueado',
};

const BILLING_PERIOD_LABELS: Readonly<Record<string, string>> = {
  monthly: 'Mensal',
  mensal: 'Mensal',
  annual: 'Anual',
  anual: 'Anual',
};

const BRAZILIAN_DATE_TIME_PATTERN = /^\d{2}\/\d{2}\/\d{4} às \d{2}:\d{2}$/u;
const BRAZILIAN_AMOUNT_PATTERN = /^-?\d{1,3}(?:\.\d{3})*,\d{2}$/u;

const formatMappedLabel = (
  value: string | null | undefined,
  labels: Readonly<Record<string, string>>
): string | null => {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return labels[trimmed.toLocaleLowerCase('pt-BR')] ?? trimmed;
};

const formatCpf = (digits: string): string =>
  `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9, 11)}`;

const formatLocalPhone = (digits: string): string =>
  digits.length === 11
    ? `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
    : `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;

export const formatChatbotUnderchatStatus = (
  value: string | null | undefined
): string | null => formatMappedLabel(value, STATUS_LABELS);

export const formatChatbotUnderchatBillingPeriod = (
  value: string | null | undefined
): string | null => formatMappedLabel(value, BILLING_PERIOD_LABELS);

export const formatChatbotUnderchatDocument = (
  value: string | null | undefined
): string | null => {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  const normalized = normalizeCnpj(trimmed);
  if (/^\d{11}$/u.test(normalized)) return formatCpf(normalized);
  if (/^[A-Z0-9]{14}$/u.test(normalized)) return formatCnpj(normalized);
  return trimmed;
};

export const formatChatbotUnderchatPhone = (
  value: string | null | undefined
): string | null => {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  const digits = trimmed.replaceAll(/\D/gu, '');
  if (/^55\d{10,11}$/u.test(digits)) return formatPhoneBR(digits);
  if (/^\d{10,11}$/u.test(digits)) return formatLocalPhone(digits);
  return trimmed;
};

export const formatChatbotUnderchatDateTime = (
  value: string | null | undefined
): string | null => {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (BRAZILIAN_DATE_TIME_PATTERN.test(trimmed)) return trimmed;

  const date = new Date(trimmed);
  return Number.isFinite(date.getTime()) ? formatDateTime(date) : null;
};

export const formatChatbotUnderchatAmount = (
  value: string | number | null | undefined
): string | null => {
  if (value === null || value === undefined) return null;
  if (
    typeof value === 'string' &&
    BRAZILIAN_AMOUNT_PATTERN.test(value.trim())
  ) {
    return value.trim();
  }

  const amount = typeof value === 'number' ? value : Number(value.trim());
  if (!Number.isFinite(amount)) return null;

  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
};

export const createChatbotUnderchatVariableOutput = (
  output: ChatbotUnderchatLookupOutput
) => ({
  user: {
    ...output.user,
    status: formatChatbotUnderchatStatus(output.user.status),
    document: formatChatbotUnderchatDocument(output.user.document),
    phone: formatChatbotUnderchatPhone(output.user.phone),
  },
  account: {
    ...output.account,
    status: formatChatbotUnderchatStatus(output.account.status),
    billing_period: formatChatbotUnderchatBillingPeriod(
      output.account.billing_period
    ),
    last_payment_at: formatChatbotUnderchatDateTime(
      output.account.last_payment_at
    ),
    next_renewal_at: formatChatbotUnderchatDateTime(
      output.account.next_renewal_at
    ),
    last_paid_amount: formatChatbotUnderchatAmount(
      output.account.last_paid_amount
    ),
  },
});

export type ChatbotUnderchatVariableOutput = ReturnType<
  typeof createChatbotUnderchatVariableOutput
>;
