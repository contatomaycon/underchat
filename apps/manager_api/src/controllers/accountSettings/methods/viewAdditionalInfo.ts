import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
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

    return sendResponse(reply, {
      message: t('user_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
