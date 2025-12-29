import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ListRoleRequest } from '@core/schema/role/listRole/request.schema';
import { RoleListerUseCase } from '@core/useCases/role/RoleLister.useCase';

export const listRole = async (
  request: FastifyRequest<{
    Querystring: ListRoleRequest;
  }>,
  reply: FastifyReply
) => {
  const roleListerUseCase = container.resolve(RoleListerUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await roleListerUseCase.execute(
      t,
      request.query,
      tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('role_list_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('role_list_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
