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
}

export function isPostgreSQLError(error: unknown): error is PostgreSQLError {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const pgError = error as PostgreSQLError;

  return (
    typeof pgError.code === 'string' &&
    pgError.code.length === 5 &&
    /^[0-9A-Z]{5}$/.test(pgError.code)
  );
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
