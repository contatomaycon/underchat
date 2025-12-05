import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { AccountSettingsAdditionalInfoViewerUseCase } from '@core/useCases/accountSettings/AccountSettingsAdditionalInfoViewer.useCase';

export const viewAdditionalInfo = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const accountSettingsAdditionalInfoViewerUseCase = container.resolve(
    AccountSettingsAdditionalInfoViewerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await accountSettingsAdditionalInfoViewerUseCase.execute(
      t,
      tokenJwtData.user_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('user_additional_info_view_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    request.server.logger.info(response, request.id);

    return sendResponse(reply, {
      message: t('user_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
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
