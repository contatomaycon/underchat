import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { CreateRoleRequest } from '@core/schema/role/createServer/request.schema';
import { RoleCreatorUseCase } from '@core/useCases/role/RoleCreator.useCase';

export const createRole = async (
  request: FastifyRequest<{
    Body: CreateRoleRequest;
  }>,
  reply: FastifyReply
) => {
  const roleCreatorUseCase = container.resolve(RoleCreatorUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await roleCreatorUseCase.execute(
      t,
      request.body.name,
      tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('role_creator_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    request.server.logger.info(response, request.id);

    return sendResponse(reply, {
      message: t('role_creator_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    request.server.logger.error(error, request.id);

    if (error instanceof Error) {
      return sendResponse(reply, {
        message: error.message,
        httpStatusCode: EHTTPStatusCode.internal_server_error,
      });
    }

    return sendResponse(reply, {
      message: t('internal_server_error'),
      httpStatusCode: EHTTPStatusCode.internal_server_error,
    });
  }
};
