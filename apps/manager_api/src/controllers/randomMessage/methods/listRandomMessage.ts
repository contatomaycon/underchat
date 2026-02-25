import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ListRandomMessageRequest } from '@core/schema/randomMessage/listRandomMessage/request.schema';
import { RandomMessageListerUseCase } from '@core/useCases/randomMessage/RandomMessageLister.useCase';

export const listRandomMessage = async (
  request: FastifyRequest<{
    Querystring: ListRandomMessageRequest;
  }>,
  reply: FastifyReply
) => {
  const randomMessageListerUseCase = container.resolve(
    RandomMessageListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await randomMessageListerUseCase.execute(
      request.query,
      tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('random_message_list_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('random_message_list_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
