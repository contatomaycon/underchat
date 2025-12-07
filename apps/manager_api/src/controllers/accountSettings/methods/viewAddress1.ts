import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { AccountSettingsAddress1ViewerUseCase } from '@core/useCases/accountSettings/AccountSettingsAddress1Viewer.useCase';

export const viewAddress1 = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const accountSettingsAddress1ViewerUseCase = container.resolve(
    AccountSettingsAddress1ViewerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await accountSettingsAddress1ViewerUseCase.execute(
      t,
      tokenJwtData.user_id
    );

    return sendResponse(reply, {
      message: t('user_address1_view_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    console.error(error);

    if (error instanceof Error) {
      return sendResponse(reply, {
        message: error.message,
        httpStatusCode: EHTTPStatusCode.bad_request,
      });
    }

    return sendResponse(reply, {
      message: t('internal_server_error'),
      httpStatusCode: EHTTPStatusCode.internal_server_error,
    });
  }
};
