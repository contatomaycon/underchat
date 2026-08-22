import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { UserService } from '@core/services/user.service';
import { ViewUserChannelsParamsRequest } from '@core/schema/user/viewUserChannels/request.schema';

export const viewUserChannels = async (
  request: FastifyRequest<{
    Params: ViewUserChannelsParamsRequest;
  }>,
  reply: FastifyReply
) => {
  const userService = container.resolve(UserService);
  const { t, tokenJwtData } = request;

  try {
    const response = await userService.listUserChannelsByUserId(
      tokenJwtData.account_id,
      request.params.user_id
    );

    return sendResponse(reply, {
      message: t('user_channels_view_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
