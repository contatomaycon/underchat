import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { AccountSettingsPhotoDeleterUseCase } from '@core/useCases/accountSettings/AccountSettingsPhotoDeleter.useCase';

export const deletePhoto = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const accountSettingsPhotoDeleterUseCase = container.resolve(
    AccountSettingsPhotoDeleterUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await accountSettingsPhotoDeleterUseCase.execute(
      t,
      tokenJwtData.user_id,
      tokenJwtData.account_id
    );

    return sendResponse(reply, {
      message: t('profile_photo_delete_success'),
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
