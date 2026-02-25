import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ViewRandomMessageRequest } from '@core/schema/randomMessage/viewRandomMessage/request.schema';
import { RandomMessageViewerUseCase } from '@core/useCases/randomMessage/RandomMessageViewer.useCase';

export const viewRandomMessage = async (
  request: FastifyRequest<{
    Params: ViewRandomMessageRequest;
  }>,
  reply: FastifyReply
) => {
  const randomMessageViewerUseCase = container.resolve(
    RandomMessageViewerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await randomMessageViewerUseCase.execute(
      t,
      request.params.random_message_id,
      tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('random_message_view_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('random_message_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
