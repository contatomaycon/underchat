import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { UpdatePhotoRequest } from '@core/schema/accountSettings/updatePhoto/request.schema';
import { AccountSettingsPhotoUpdaterUseCase } from '@core/useCases/accountSettings/AccountSettingsPhotoUpdater.useCase';

export const updatePhoto = async (
  request: FastifyRequest<{
    Body: UpdatePhotoRequest;
  }>,
  reply: FastifyReply
) => {
  const accountSettingsPhotoUpdaterUseCase = container.resolve(
    AccountSettingsPhotoUpdaterUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await accountSettingsPhotoUpdaterUseCase.execute(
      t,
      tokenJwtData.user_id,
      tokenJwtData.account_id,
      request.body
    );

    return sendResponse(reply, {
      message: t('profile_photo_upload_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
