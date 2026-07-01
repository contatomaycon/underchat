import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { WhatsappOfficialWebhookSubscriptionEnsurerUseCase } from '@core/useCases/worker/WhatsappOfficialWebhookSubscriptionEnsurer.useCase';
import { EnsureWhatsappOfficialWebhookSubscriptionParams } from '@core/schema/worker/ensureWhatsappOfficialWebhookSubscription/params.schema';

export const ensureWhatsappOfficialWebhookSubscription = async (
  request: FastifyRequest<{
    Params: EnsureWhatsappOfficialWebhookSubscriptionParams;
  }>,
  reply: FastifyReply
) => {
  const useCase = container.resolve(
    WhatsappOfficialWebhookSubscriptionEnsurerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await useCase.execute(
      t,
      tokenJwtData.account_id,
      request.params.worker_id
    );

    return sendResponse(reply, {
      message: t('whatsapp_official_webhook_subscription_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
