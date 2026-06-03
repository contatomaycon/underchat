import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { ChatNotificationSettingsRequest } from '@core/schema/chat/notificationSettings/request.schema';
import { ChatNotificationSettingsUpdaterUseCase } from '@core/useCases/chat/ChatNotificationSettingsUpdater.useCase';

export const updateNotificationSettings = async (
  request: FastifyRequest<{ Body: ChatNotificationSettingsRequest }>,
  reply: FastifyReply
) => {
  const useCase = container.resolve(ChatNotificationSettingsUpdaterUseCase);
  const { tokenJwtData, t } = request;

  try {
    const response = await useCase.execute(tokenJwtData.user_id, request.body);

    return sendResponse(reply, {
      message: t('notifications_update_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
