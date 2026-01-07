import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { UserSectorsListerUseCase } from '@core/useCases/user/UserSectorsLister.useCase';

export const listUserSectors = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const userSectorsListerUseCase = container.resolve(UserSectorsListerUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await userSectorsListerUseCase.execute(
      tokenJwtData.account_id
    );

    return sendResponse(reply, {
      message: t('user_sectors_list_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
