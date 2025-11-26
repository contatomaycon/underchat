import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { DeleteChatContactPhotoRequest } from '@core/schema/chat/deleteContactPhoto/request.schema';
import { ChatContactPhotoDeleterUseCase } from '@core/useCases/chat/ChatContactPhotoDeleter.useCase';

export const deleteContactPhoto = async (
  request: FastifyRequest<{
    Params: DeleteChatContactPhotoRequest;
  }>,
  reply: FastifyReply
) => {
  const chatContactPhotoDeleterUseCase = container.resolve(
    ChatContactPhotoDeleterUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await chatContactPhotoDeleterUseCase.execute(
      t,
      request.params.contact_id,
      tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('contact_photo_deleted_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: null,
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
