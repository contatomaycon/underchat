interface PostgreSQLError {
  code?: string;
  detail?: string;
  hint?: string;
  message?: string;
  severity?: string;
  length?: number;
  schema?: string;
  table?: string;
  column?: string;
  constraint?: string;
  file?: string;
  line?: string;
  routine?: string;
  cause?: unknown;
}

export function isPostgreSQLError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const pgError = error as PostgreSQLError;

  if (
    typeof pgError.code === 'string' &&
    pgError.code.length === 5 &&
    /^[0-9A-Z]{5}$/.test(pgError.code)
  ) {
    return true;
  }

  if (pgError.cause && typeof pgError.cause === 'object') {
    const causeError = pgError.cause as PostgreSQLError;
    if (
      typeof causeError.code === 'string' &&
      causeError.code.length === 5 &&
      /^[0-9A-Z]{5}$/.test(causeError.code)
    ) {
      return true;
    }
  }

  if (pgError.message && typeof pgError.message === 'string') {
    const message = pgError.message.toLowerCase();
    if (
      message.includes('failed query') ||
      message.includes('query failed') ||
      message.includes('database error') ||
      message.includes('sql error')
    ) {
      return true;
    }
  }

  return false;
}

export function getPostgreSQLErrorMessage(error: PostgreSQLError): string {
  if (error.message) {
    return error.message;
  }

  if (error.detail) {
    return error.detail;
  }

  return 'Erro de consulta ao banco de dados';
}
