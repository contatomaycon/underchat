import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { UserService } from '@core/services/user.service';
import { ViewUserSectorsParamsRequest } from '@core/schema/user/viewUserSectors/request.schema';

export const viewUserSectors = async (
  request: FastifyRequest<{
    Params: ViewUserSectorsParamsRequest;
  }>,
  reply: FastifyReply
) => {
  const userService = container.resolve(UserService);
  const { t, tokenJwtData } = request;

  try {
    const response = await userService.listUserSectors(
      tokenJwtData.account_id,
      request.params.user_id
    );

    return sendResponse(reply, {
      message: t('user_sectors_view_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
