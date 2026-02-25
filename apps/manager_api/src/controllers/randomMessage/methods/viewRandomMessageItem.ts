import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ViewRandomMessageItemRequest } from '@core/schema/randomMessage/viewRandomMessageItem/request.schema';
import { RandomMessageItemViewerUseCase } from '@core/useCases/randomMessage/RandomMessageItemViewer.useCase';

export const viewRandomMessageItem = async (
  request: FastifyRequest<{
    Params: ViewRandomMessageItemRequest;
  }>,
  reply: FastifyReply
) => {
  const randomMessageItemViewerUseCase = container.resolve(
    RandomMessageItemViewerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await randomMessageItemViewerUseCase.execute(
      t,
      request.params.random_message_id,
      request.params.random_message_item_id,
      tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('random_message_item_view_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('random_message_item_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
