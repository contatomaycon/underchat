import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { AccountCustomizationCreatorUseCase } from '@core/useCases/accountSettings/AccountCustomizationCreator.useCase';
import { CreateAccountCustomizationRequest } from '@core/schema/accountSettings/createAccountCustomization/request.schema';

export const createAccountCustomization = async (
  request: FastifyRequest<{
    Body: CreateAccountCustomizationRequest;
  }>,
  reply: FastifyReply
) => {
  const accountCustomizationCreatorUseCase = container.resolve(
    AccountCustomizationCreatorUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await accountCustomizationCreatorUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.body
    );

    if (response) {
      return sendResponse(reply, {
        message: t('account_info_creator_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('account_info_creator_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    console.error(error);

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
