import type { FastifyReply } from 'fastify';
import type { TFunction } from 'i18next';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { sendResponse } from '@core/common/functions/sendResponse';

const NOT_FOUND_KEYS = [
  'account_not_found',
  'chat_create_not_found',
  'chat_not_found',
  'chatbot_not_found',
  'contact_not_found',
  'label_template_not_found',
  'official_opening_connection_not_found',
  'official_template_not_approved_or_not_found',
  'sector_not_found',
  'user_not_found',
  'worker_not_found',
] as const;

const FORBIDDEN_KEYS = [
  'chat_access_denied',
  'chat_only_primary_can_close',
  'chat_only_primary_can_transfer',
  'chat_only_secondary_can_leave',
  'contact_channel_not_allowed',
  'reopen_chat_permission_denied',
] as const;

const BAD_REQUEST_KEYS = [
  'attendance_only_online_allowed',
  'channel_required',
  'chat_already_in_service',
  'chat_bulk_category_required',
  'chat_bulk_ids_required',
  'chat_cannot_transfer_to_current_primary',
  'chat_join_only_in_chat',
  'chat_join_required',
  'chat_leave_only_in_chat',
  'contact_already_exists_email',
  'contact_already_exists_phone',
  'contact_already_validated',
  'contact_channel_not_available',
  'contact_must_be_validated',
  'contact_phone_required',
  'contact_not_available',
  'contact_not_available_additional',
  'date_must_be_greater_than_1900_01_01',
  'date_must_be_in_the_format_yyyy_mm_dd',
  'date_must_be_less_than_today',
  'name_required',
  'official_opening_only_official_channel',
  'official_template_required_for_opening',
  'official_template_variables_required',
  'whatsapp_official_template_send_uncertain',
  'whatsapp_official_waiting_contact_reply',
  'phone_ddi_required',
  'phone_number_not_valid_on_whatsapp',
  'phone_required',
  'phone_required_for_validation',
  'phone_required_when_ddi_provided',
  'transfer_chatbot_cannot_combine_targets',
  'transfer_requires_user_or_sector',
  'user_unavailable_for_transfer',
] as const;

const SERVICE_UNAVAILABLE_KEYS = [
  'no_active_worker_for_validation',
  'phone_validation_timeout',
] as const;

const CONFLICT_KEYS = ['official_window_requires_template_refresh'] as const;

interface HandleChatMutationControllerErrorOptions {
  readonly sanitizeUnexpected?: boolean;
}

interface InterpolatedRule {
  readonly key:
    | 'chat_already_in_service_with_sector'
    | 'simultaneous_attendance_limit_reached';
  readonly variable: 'sector' | 'limit';
  readonly statusCode: EHTTPStatusCode;
}

const INTERPOLATED_RULES: readonly InterpolatedRule[] = [
  {
    key: 'chat_already_in_service_with_sector',
    variable: 'sector',
    statusCode: EHTTPStatusCode.bad_request,
  },
  {
    key: 'simultaneous_attendance_limit_reached',
    variable: 'limit',
    statusCode: EHTTPStatusCode.bad_request,
  },
];

function resolveTranslatedDomainMessage(
  message: string,
  t: TFunction<'translation', undefined>,
  keys: readonly string[]
): string | null {
  for (const key of keys) {
    if (message === key) return t(key);
    if (message === t(key)) return message;
  }
  return null;
}

function matchesInterpolatedRule(
  message: string,
  t: TFunction<'translation', undefined>,
  rule: InterpolatedRule
): boolean {
  const marker = '__UNDERCHAT_DOMAIN_VALUE__';
  const translated = t(rule.key, { [rule.variable]: marker });
  const markerIndex = translated.indexOf(marker);
  if (markerIndex < 0) return false;

  const prefix = translated.slice(0, markerIndex);
  const suffix = translated.slice(markerIndex + marker.length);
  return message.startsWith(prefix) && message.endsWith(suffix);
}

function sendDomainError(
  reply: FastifyReply,
  message: string,
  httpStatusCode: EHTTPStatusCode
): void {
  sendResponse(reply, { message, httpStatusCode });
}

/** Maps only expected chat/contact mutation failures to an explicit HTTP 4xx/503. */
export function handleChatMutationControllerError(
  error: unknown,
  reply: FastifyReply,
  t: TFunction<'translation', undefined>,
  options: HandleChatMutationControllerErrorOptions = {}
): void {
  if (!(error instanceof Error)) {
    handleControllerError(error, reply, t);
    return;
  }

  const message = error.message;
  const conflictMessage = resolveTranslatedDomainMessage(
    message,
    t,
    CONFLICT_KEYS
  );
  if (conflictMessage) {
    sendResponse(reply, {
      message: conflictMessage,
      httpStatusCode: EHTTPStatusCode.conflict,
      data: { reason: 'official_window_requires_template_refresh' },
    });
    return;
  }
  const notFoundMessage = resolveTranslatedDomainMessage(
    message,
    t,
    NOT_FOUND_KEYS
  );
  if (notFoundMessage) {
    sendDomainError(reply, notFoundMessage, EHTTPStatusCode.not_found);
    return;
  }

  const forbiddenMessage = resolveTranslatedDomainMessage(
    message,
    t,
    FORBIDDEN_KEYS
  );
  if (forbiddenMessage) {
    sendDomainError(reply, forbiddenMessage, EHTTPStatusCode.forbidden);
    return;
  }

  const badRequestMessage = resolveTranslatedDomainMessage(
    message,
    t,
    BAD_REQUEST_KEYS
  );
  if (badRequestMessage) {
    sendDomainError(reply, badRequestMessage, EHTTPStatusCode.bad_request);
    return;
  }

  const serviceUnavailableMessage = resolveTranslatedDomainMessage(
    message,
    t,
    SERVICE_UNAVAILABLE_KEYS
  );
  if (serviceUnavailableMessage) {
    sendDomainError(
      reply,
      serviceUnavailableMessage,
      EHTTPStatusCode.service_unavailable
    );
    return;
  }

  const interpolatedRule = INTERPOLATED_RULES.find((rule) =>
    matchesInterpolatedRule(message, t, rule)
  );
  if (interpolatedRule) {
    sendDomainError(reply, message, interpolatedRule.statusCode);
    return;
  }

  if (options.sanitizeUnexpected) {
    reply.request.log.error(
      { err: error, type: 'chat_mutation_unhandled_error' },
      'Unhandled chat mutation error'
    );
    sendResponse(reply, {
      message: t('internal_server_error'),
      httpStatusCode: EHTTPStatusCode.internal_server_error,
    });
    return;
  }

  handleControllerError(error, reply, t);
}
