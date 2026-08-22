import { FastifyReply } from 'fastify';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { DrizzleQueryError } from 'drizzle-orm';
import { TFunction } from 'i18next';
import {
  isPlanEntitlementDenyFenceRequiredError,
  PlanEntitlementDeniedError,
  PlanEntitlementUnavailableError,
} from '@core/common/exceptions/PlanEntitlementError';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';
import {
  ArchivedUserCardNotFoundError,
  CreditCardAlreadyTokenizedError,
  CreditCardSourceSelectionError,
} from '@core/common/exceptions/UserCardError';

export function handleControllerError(
  error: unknown,
  reply: FastifyReply,
  t?: TFunction<'translation', undefined>
): void {
  if (
    error instanceof Error &&
    error.message.startsWith('worker_lifecycle_journal_invalid:')
  ) {
    sendResponse(reply, {
      message: t
        ? t('worker_lifecycle_journal_invalid')
        : 'The channel lifecycle operation could not be resumed safely. Please try again.',
      httpStatusCode: EHTTPStatusCode.conflict,
    });

    return;
  }

  if (error instanceof PlanEntitlementDeniedError) {
    const isIntegration =
      error.entitlement.planProductId === EPlanProduct.integration;
    sendResponse(reply, {
      message: t
        ? t(isIntegration ? 'integration_not_available' : 'permission_denied')
        : isIntegration
          ? 'Integration is not available for the current plan.'
          : 'The current plan does not include this product.',
      httpStatusCode: EHTTPStatusCode.payment_required,
      data: {
        reason: isIntegration
          ? 'integration_plan_required'
          : 'plan_product_required',
        plan_product_id: error.entitlement.planProductId,
      },
    });

    return;
  }

  if (
    error instanceof PlanEntitlementUnavailableError ||
    isPlanEntitlementDenyFenceRequiredError(error)
  ) {
    sendResponse(reply, {
      message: t
        ? t('plan_entitlement_unavailable')
        : 'Plan entitlement is temporarily unavailable.',
      httpStatusCode: EHTTPStatusCode.service_unavailable,
      data: {
        reason: 'plan_entitlement_unavailable',
        plan_product_id: EPlanProduct.integration,
      },
    });

    return;
  }

  if (error instanceof CreditCardAlreadyTokenizedError) {
    sendResponse(reply, {
      message: t
        ? t('card_already_tokenized')
        : 'This card is already saved. Restore it from archived cards to use it.',
      httpStatusCode: EHTTPStatusCode.conflict,
    });

    return;
  }

  if (error instanceof CreditCardSourceSelectionError) {
    sendResponse(reply, {
      message: t
        ? t('credit_card_requires_exactly_one_source')
        : 'Select a saved card or enter a new card, but not both.',
      httpStatusCode: EHTTPStatusCode.bad_request,
    });

    return;
  }

  if (error instanceof ArchivedUserCardNotFoundError) {
    sendResponse(reply, {
      message: t ? t('card_not_found') : 'Card not found',
      httpStatusCode: EHTTPStatusCode.not_found,
    });

    return;
  }

  if (error instanceof DrizzleQueryError) {
    sendResponse(reply, {
      message: t
        ? t('internal_database_error')
        : 'Error 1064: An internal error occurred, please contact support.',
      httpStatusCode: EHTTPStatusCode.internal_server_error,
    });

    return;
  }

  if (error instanceof Error) {
    sendResponse(reply, {
      message: error.message,
      httpStatusCode: EHTTPStatusCode.internal_server_error,
    });

    return;
  }

  sendResponse(reply, {
    message: t ? t('internal_server_error') : 'Internal server error!',
    httpStatusCode: EHTTPStatusCode.internal_server_error,
  });
}
