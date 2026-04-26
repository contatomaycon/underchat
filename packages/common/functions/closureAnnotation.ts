export type TClosureAnnotationSubtype = 'closure' | 'closure_audit' | null;

export type TClosureAnnotationKind = 'reason' | 'audit' | null;

const OPERATOR_AUDIT_PATTERNS = [
  /^atendimento finalizado pelo operador\b/,
  /^attendance finished by operator\b/,
  /^atencion finalizada por el operador\b/,
];

const INACTIVITY_AUDIT_PATTERNS = [
  /^atendimento finalizado por inatividade\.?$/,
  /^attendance finished due to inactivity\.?$/,
  /^atencion finalizada por inactividad\.?$/,
];

const normalizeClosureText = (value?: string | null): string => {
  if (!value) return '';
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
};

export const isLegacyClosureAuditMessage = (message?: string | null): boolean => {
  const normalizedMessage = normalizeClosureText(message);
  if (!normalizedMessage) return false;

  return [...OPERATOR_AUDIT_PATTERNS, ...INACTIVITY_AUDIT_PATTERNS].some(
    (pattern) => pattern.test(normalizedMessage)
  );
};

export const resolveClosureAnnotationKind = (
  annotationSubtype?: TClosureAnnotationSubtype,
  message?: string | null
): TClosureAnnotationKind => {
  if (annotationSubtype === 'closure_audit') return 'audit';

  if (annotationSubtype === 'closure') {
    if (isLegacyClosureAuditMessage(message)) return 'audit';
    return 'reason';
  }

  return null;
};
