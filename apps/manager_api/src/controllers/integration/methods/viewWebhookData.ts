import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { WebhookDataViewerUseCase } from '@core/useCases/integration/WebhookDataViewer.useCase';

export const viewWebhookData = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const webhookDataViewerUseCase = container.resolve(WebhookDataViewerUseCase);
  const { t, tokenJwtData } = request;

  try {
    const result = await webhookDataViewerUseCase.execute(
      tokenJwtData.account_id
    );

    return sendResponse(reply, {
      message: t('webhook_data_viewed_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: { data: result },
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
