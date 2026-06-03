import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { ChatNotificationSettingsViewerUseCase } from '@core/useCases/chat/ChatNotificationSettingsViewer.useCase';

export const viewNotificationSettings = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const useCase = container.resolve(ChatNotificationSettingsViewerUseCase);
  const { tokenJwtData, t } = request;

  try {
    const response = await useCase.execute(tokenJwtData.user_id);

    return sendResponse(reply, {
      message: t('chat_list_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
