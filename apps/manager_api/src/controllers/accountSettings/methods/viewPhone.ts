import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { AccountSettingsPhoneViewerUseCase } from '@core/useCases/accountSettings/AccountSettingsPhoneViewer.useCase';

export const viewPhone = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const accountSettingsPhoneViewerUseCase = container.resolve(
    AccountSettingsPhoneViewerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await accountSettingsPhoneViewerUseCase.execute(
      t,
      tokenJwtData.user_id
    );

    return sendResponse(reply, {
      message: t('user_phone_view_successfully'),
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
