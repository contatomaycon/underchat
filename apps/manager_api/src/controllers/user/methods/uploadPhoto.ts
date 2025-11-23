import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
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
      tokenJwtData.is_administrator,
      request.body
    );

    return sendResponse(reply, {
      message: t('profile_photo_upload_success'),
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
