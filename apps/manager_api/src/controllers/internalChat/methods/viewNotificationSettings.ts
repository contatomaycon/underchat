import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { InternalChatNotificationSettingsViewerUseCase } from '@core/useCases/internalChat/InternalChatNotificationSettingsViewer.useCase';
import { handleInternalChatError } from '@core/common/functions/handleInternalChatError';

export const viewNotificationSettings = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const useCase = container.resolve(
    InternalChatNotificationSettingsViewerUseCase
  );
  const { tokenJwtData, t } = request;

  try {
    const response = await useCase.execute(tokenJwtData.user_id);

    return sendResponse(reply, {
      message: t('chat_list_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleInternalChatError(error, reply, t);
  }
};
