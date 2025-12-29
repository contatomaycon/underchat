import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { DeleteContactPhotoRequest } from '@core/schema/contact/deletePhoto/request.schema';
import { ContactPhotoDeleterUseCase } from '@core/useCases/contact/ContactPhotoDeleter.useCase';

export const deletePhoto = async (
  request: FastifyRequest<{
    Params: DeleteContactPhotoRequest;
  }>,
  reply: FastifyReply
) => {
  const contactPhotoDeleterUseCase = container.resolve(
    ContactPhotoDeleterUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await contactPhotoDeleterUseCase.execute(
      t,
      request.params.contact_id,
      tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('contact_photo_deleted_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    return sendResponse(reply, {
      message: t('contact_photo_delete_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
