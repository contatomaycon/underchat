import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { InternalChatNotificationSettingsRequest } from '@core/schema/internalChat/notificationSettings/request.schema';
import { InternalChatNotificationSettingsUpdaterUseCase } from '@core/useCases/internalChat/InternalChatNotificationSettingsUpdater.useCase';
import { handleInternalChatError } from '@core/common/functions/handleInternalChatError';

export const updateNotificationSettings = async (
  request: FastifyRequest<{ Body: InternalChatNotificationSettingsRequest }>,
  reply: FastifyReply
) => {
  const useCase = container.resolve(
    InternalChatNotificationSettingsUpdaterUseCase
  );
  const { tokenJwtData, t } = request;

  try {
    const response = await useCase.execute(tokenJwtData.user_id, request.body);

    return sendResponse(reply, {
      message: t('notifications_update_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleInternalChatError(error, reply, t);
  }
};
