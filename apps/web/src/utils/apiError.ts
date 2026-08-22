import { isAxiosError } from 'axios';

type ErrorPayload = {
  id?: unknown;
  reason?: unknown;
  request_id?: unknown;
  requestId?: unknown;
  data?: {
    reason?: unknown;
    request_id?: unknown;
    requestId?: unknown;
  } | null;
};

const asNonEmptyString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const getPayload = (error: unknown): ErrorPayload | null => {
  if (!isAxiosError(error) || !error.response?.data) {
    return null;
  }

  return typeof error.response.data === 'object'
    ? (error.response.data as ErrorPayload)
    : null;
};

export const getApiErrorStatus = (error: unknown): number | null =>
  isAxiosError(error) && typeof error.response?.status === 'number'
    ? error.response.status
    : null;

export const getApiErrorReason = (error: unknown): string | null => {
  const payload = getPayload(error);
  return (
    asNonEmptyString(payload?.data?.reason) ?? asNonEmptyString(payload?.reason)
  );
};

export const getApiErrorRequestId = (error: unknown): string | null => {
  if (!isAxiosError(error)) {
    return null;
  }

  const payload = getPayload(error);
  const headers = error.response?.headers;

  return (
    asNonEmptyString(payload?.id) ??
    asNonEmptyString(payload?.data?.request_id) ??
    asNonEmptyString(payload?.data?.requestId) ??
    asNonEmptyString(payload?.request_id) ??
    asNonEmptyString(payload?.requestId) ??
    asNonEmptyString(headers?.['x-request-id']) ??
    asNonEmptyString(headers?.['x-correlation-id']) ??
    null
  );
};

export const OFFICIAL_WINDOW_REQUIRES_TEMPLATE_REFRESH =
  'official_window_requires_template_refresh';

export const isOfficialWindowRefreshConflict = (error: unknown): boolean =>
  getApiErrorStatus(error) === 409 &&
  getApiErrorReason(error) === OFFICIAL_WINDOW_REQUIRES_TEMPLATE_REFRESH;
