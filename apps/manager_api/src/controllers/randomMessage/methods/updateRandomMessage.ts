import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import {
  UpdateRandomMessageParams,
  UpdateRandomMessageRequest,
} from '@core/schema/randomMessage/updateRandomMessage/request.schema';
import { RandomMessageUpdaterUseCase } from '@core/useCases/randomMessage/RandomMessageUpdater.useCase';

export const updateRandomMessage = async (
  request: FastifyRequest<{
    Params: UpdateRandomMessageParams;
    Body: UpdateRandomMessageRequest;
  }>,
  reply: FastifyReply
) => {
  const randomMessageUpdaterUseCase = container.resolve(
    RandomMessageUpdaterUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await randomMessageUpdaterUseCase.execute(
      t,
      request.params.random_message_id,
      tokenJwtData.account_id,
      request.body
    );

    if (response) {
      return sendResponse(reply, {
        message: t('random_message_update_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    return sendResponse(reply, {
      message: t('random_message_update_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
