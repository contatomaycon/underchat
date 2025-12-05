import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { AccountSettingsAddressViewerUseCase } from '@core/useCases/accountSettings/AccountSettingsAddressViewer.useCase';

export const viewAddress = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const accountSettingsAddressViewerUseCase = container.resolve(
    AccountSettingsAddressViewerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await accountSettingsAddressViewerUseCase.execute(
      t,
      tokenJwtData.user_id
    );

    return sendResponse(reply, {
      message: t('user_address_view_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    request.server.logger.error(error, request.id);

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
