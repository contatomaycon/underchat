import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { UserSectorsListerUseCase } from '@core/useCases/user/UserSectorsLister.useCase';
import { canOperateOnOtherAccounts } from '@core/common/functions/hasFullAccess';
import { ListUserSectorsRequest } from '@core/schema/user/listUserSectors/request.schema';

export const listUserSectors = async (
  request: FastifyRequest<{
    Querystring: ListUserSectorsRequest;
  }>,
  reply: FastifyReply
) => {
  const userSectorsListerUseCase = container.resolve(UserSectorsListerUseCase);
  const { t, tokenJwtData } = request;
  const canOperateOnOthers = canOperateOnOtherAccounts(tokenJwtData.actions);

  try {
    const accountIdToUse =
      canOperateOnOthers && request.query.account_id
        ? request.query.account_id
        : tokenJwtData.account_id;

    const response = await userSectorsListerUseCase.execute(accountIdToUse);

    return sendResponse(reply, {
      message: t('user_sectors_list_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
