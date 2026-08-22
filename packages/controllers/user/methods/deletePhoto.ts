import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { DeletePhotoParams } from '@core/schema/user/deletePhoto/request.schema';
import { UserPhotoDeleterUseCase } from '@core/useCases/user/UserPhotoDeleter.useCase';

export const deletePhoto = async (
  request: FastifyRequest<{
    Params: DeletePhotoParams;
  }>,
  reply: FastifyReply
) => {
  const userPhotoDeleterUseCase = container.resolve(UserPhotoDeleterUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await userPhotoDeleterUseCase.execute(
      t,
      request.params.user_id,
      tokenJwtData.account_id
    );

    return sendResponse(reply, {
      message: t('profile_photo_remove_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
