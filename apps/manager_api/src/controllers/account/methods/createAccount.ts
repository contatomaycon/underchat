import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
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
  const { t } = request;

  try {
    const response = await accountCreatorUseCase.execute(t, request.body);

    if (response) {
      return sendResponse(reply, {
        message: t('account_creator_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('account_creator_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
