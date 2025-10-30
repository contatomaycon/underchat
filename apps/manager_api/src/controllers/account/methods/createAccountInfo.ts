import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { CreateAccountInfoRequest } from '@core/schema/account/createAccountInfo/request.schema';
import { AccountInfoCreatorUseCase } from '@core/useCases/account/AccountInfoCreator.useCase';

export const createAccountInfo = async (
  request: FastifyRequest<{
    Body: CreateAccountInfoRequest;
  }>,
  reply: FastifyReply
) => {
  const accountInfoCreatorUseCase = container.resolve(
    AccountInfoCreatorUseCase
  );
  const { t } = request;

  try {
    const response = await accountInfoCreatorUseCase.execute(t, request.body);

    if (response) {
      return sendResponse(reply, {
        message: t('account_info_creator_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    request.server.logger.info(response, request.id);

    return sendResponse(reply, {
      message: t('account_info_creator_error'),
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
