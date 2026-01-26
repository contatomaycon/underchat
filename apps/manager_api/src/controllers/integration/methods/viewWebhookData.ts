import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { WebhookDataViewerUseCase } from '@core/useCases/integration/WebhookDataViewer.useCase';
import { ViewWebhookDataRequest } from '@core/schema/integration/viewWebhookData/request.schema';

export const viewWebhookData = async (
  request: FastifyRequest<{
    Querystring: ViewWebhookDataRequest;
  }>,
  reply: FastifyReply
) => {
  const webhookDataViewerUseCase = container.resolve(WebhookDataViewerUseCase);
  const { t, tokenJwtData } = request;

  try {
    const result = await webhookDataViewerUseCase.execute(
      tokenJwtData.account_id,
      request.query.api_key_id
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
