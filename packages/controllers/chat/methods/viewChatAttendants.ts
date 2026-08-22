import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ChatAttendantsViewerUseCase } from '@core/useCases/chat/ChatAttendantsViewer.useCase';
import { ViewChatAttendantsParams } from '@core/schema/chat/viewChatAttendants/request.schema';

export const viewChatAttendants = async (
  request: FastifyRequest<{
    Params: ViewChatAttendantsParams;
  }>,
  reply: FastifyReply
) => {
  const chatAttendantsViewerUseCase = container.resolve(
    ChatAttendantsViewerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await chatAttendantsViewerUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.params,
      tokenJwtData.user_id,
      tokenJwtData.actions,
      tokenJwtData.sectors,
      tokenJwtData.channels
    );

    return sendResponse(reply, {
      message: t('chat_attendants_info_view_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    if (error instanceof Error) {
      if (
        error.message === t('chat_attendants_info_permission_denied') ||
        error.message === t('chat_access_denied')
      ) {
        return sendResponse(reply, {
          message: error.message,
          httpStatusCode: EHTTPStatusCode.forbidden,
        });
      }
    }

    handleControllerError(error, reply, t);
  }
};
