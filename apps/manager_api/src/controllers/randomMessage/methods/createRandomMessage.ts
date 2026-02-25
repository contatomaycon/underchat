import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { CreateRandomMessageRequest } from '@core/schema/randomMessage/createRandomMessage/request.schema';
import { RandomMessageCreatorUseCase } from '@core/useCases/randomMessage/RandomMessageCreator.useCase';

export const createRandomMessage = async (
  request: FastifyRequest<{
    Body: CreateRandomMessageRequest;
  }>,
  reply: FastifyReply
) => {
  const randomMessageCreatorUseCase = container.resolve(
    RandomMessageCreatorUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await randomMessageCreatorUseCase.execute(
      t,
      request.body,
      tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('random_message_creator_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: {
          random_message_id: response,
        },
      });
    }

    return sendResponse(reply, {
      message: t('random_message_creator_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
