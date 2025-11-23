import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
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

    request.server.logger.info(response, request.id);

    return sendResponse(reply, {
      message: t('contact_photo_delete_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    request.server.logger.error(error, request.id);

    if (error instanceof Error) {
      return sendResponse(reply, {
        message: error.message,
        httpStatusCode: EHTTPStatusCode.internal_server_error,
      });
    }

    return sendResponse(reply, {
      message: t('internal_server_error'),
      httpStatusCode: EHTTPStatusCode.internal_server_error,
    });
  }
};
