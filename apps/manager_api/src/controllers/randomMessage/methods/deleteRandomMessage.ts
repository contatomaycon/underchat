import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { DeleteRandomMessageRequest } from '@core/schema/randomMessage/deleteRandomMessage/request.schema';
import { RandomMessageDeleterUseCase } from '@core/useCases/randomMessage/RandomMessageDeleter.useCase';

export const deleteRandomMessage = async (
  request: FastifyRequest<{
    Params: DeleteRandomMessageRequest;
  }>,
  reply: FastifyReply
) => {
  const randomMessageDeleterUseCase = container.resolve(
    RandomMessageDeleterUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await randomMessageDeleterUseCase.execute(
      t,
      request.params.random_message_id,
      tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('random_message_deleted_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    return sendResponse(reply, {
      message: t('random_message_deleter_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
