import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { DeleteRandomMessageItemRequest } from '@core/schema/randomMessage/deleteRandomMessageItem/request.schema';
import { RandomMessageItemDeleterUseCase } from '@core/useCases/randomMessage/RandomMessageItemDeleter.useCase';

export const deleteRandomMessageItem = async (
  request: FastifyRequest<{
    Params: DeleteRandomMessageItemRequest;
  }>,
  reply: FastifyReply
) => {
  const randomMessageItemDeleterUseCase = container.resolve(
    RandomMessageItemDeleterUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await randomMessageItemDeleterUseCase.execute(
      t,
      request.params.random_message_id,
      request.params.random_message_item_id,
      tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('random_message_item_deleted_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    return sendResponse(reply, {
      message: t('random_message_item_deleter_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
