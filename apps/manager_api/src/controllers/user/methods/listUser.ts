import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ListUserRequest } from '@core/schema/user/listUser/request.schema';
import { UserListerUseCase } from '@core/useCases/user/UserLister.useCase';
import { sanitizeQueryAccountId } from '@core/common/functions/hasFullAccess';

export const listUser = async (
  request: FastifyRequest<{
    Querystring: ListUserRequest;
  }>,
  reply: FastifyReply
) => {
  const userListerUseCase = container.resolve(UserListerUseCase);
  const { t, tokenJwtData } = request;

  const { query, accountId, canReturnAll } = sanitizeQueryAccountId(
    request.query,
    tokenJwtData.actions,
    tokenJwtData.account_id
  );

  try {
    const response = await userListerUseCase.execute(
      t,
      query,
      accountId,
      canReturnAll
    );

    if (response) {
      return sendResponse(reply, {
        message: t('user_list_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('user_list_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
