import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import {
  UpdateRandomMessageItemParamsRequest,
  UpdateRandomMessageItemRequest,
} from '@core/schema/randomMessage/updateRandomMessageItem/request.schema';
import { RandomMessageItemUpdaterUseCase } from '@core/useCases/randomMessage/RandomMessageItemUpdater.useCase';

export const updateRandomMessageItem = async (
  request: FastifyRequest<{
    Params: UpdateRandomMessageItemParamsRequest;
    Body: UpdateRandomMessageItemRequest;
  }>,
  reply: FastifyReply
) => {
  const randomMessageItemUpdaterUseCase = container.resolve(
    RandomMessageItemUpdaterUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await randomMessageItemUpdaterUseCase.execute(
      t,
      request.params.random_message_id,
      request.params.random_message_item_id,
      tokenJwtData.account_id,
      request.body
    );

    if (response) {
      return sendResponse(reply, {
        message: t('random_message_item_update_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    return sendResponse(reply, {
      message: t('random_message_item_update_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
