import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { CreateAccountRequest } from '@core/schema/account/createAccount/request.schema';
import { AccountCreatorUseCase } from '@core/useCases/account/AccountCreator.useCase';

export const createAccount = async (
  request: FastifyRequest<{
    Body: CreateAccountRequest;
  }>,
  reply: FastifyReply
) => {
  const accountCreatorUseCase = container.resolve(AccountCreatorUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await accountCreatorUseCase.execute(
      t,
      request.body,
      tokenJwtData.is_administrator
    );

    if (response) {
      return sendResponse(reply, {
        message: t('account_creator_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    request.server.logger.info(response, request.id);

    return sendResponse(reply, {
      message: t('account_creator_error'),
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
