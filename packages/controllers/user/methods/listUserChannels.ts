import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { UserChannelsListerUseCase } from '@core/useCases/user/UserChannelsLister.useCase';

export const listUserChannels = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const userChannelsListerUseCase = container.resolve(
    UserChannelsListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await userChannelsListerUseCase.execute(
      tokenJwtData.account_id
    );

    return sendResponse(reply, {
      message: t('user_channels_list_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
