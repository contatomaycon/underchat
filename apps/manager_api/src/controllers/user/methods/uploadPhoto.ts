import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import {
  UploadPhotoParams,
  UploadPhotoRequest,
} from '@core/schema/user/uploadPhoto/request.schema';
import { UserPhotoUploaderUseCase } from '@core/useCases/user/UserPhotoUploader.useCase';

export const uploadPhoto = async (
  request: FastifyRequest<{
    Params: UploadPhotoParams;
    Body: UploadPhotoRequest;
  }>,
  reply: FastifyReply
) => {
  const userPhotoUploaderUseCase = container.resolve(UserPhotoUploaderUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await userPhotoUploaderUseCase.execute(
      t,
      request.params.user_id,
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
