import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
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

    return sendResponse(reply, {
      message: t('contact_photo_delete_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
