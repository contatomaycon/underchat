import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import {
  CreateRandomMessageItemParamsRequest,
  CreateRandomMessageItemRequest,
} from '@core/schema/randomMessage/createRandomMessageItem/request.schema';
import { RandomMessageItemCreatorUseCase } from '@core/useCases/randomMessage/RandomMessageItemCreator.useCase';

export const createRandomMessageItem = async (
  request: FastifyRequest<{
    Params: CreateRandomMessageItemParamsRequest;
    Body: CreateRandomMessageItemRequest;
  }>,
  reply: FastifyReply
) => {
  const randomMessageItemCreatorUseCase = container.resolve(
    RandomMessageItemCreatorUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await randomMessageItemCreatorUseCase.execute(
      t,
      request.params.random_message_id,
      request.body,
      tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('random_message_item_creator_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: {
          random_message_item_id: response,
        },
      });
    }

    return sendResponse(reply, {
      message: t('random_message_item_creator_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
