import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ViewChatAttendanceInactivityParams } from '@core/schema/chat/viewChatAttendanceInactivity/request.schema';
import { ChatAttendanceInactivityViewerUseCase } from '@core/useCases/chat/ChatAttendanceInactivityViewer.useCase';

export const viewChatAttendanceInactivity = async (
  request: FastifyRequest<{
    Params: ViewChatAttendanceInactivityParams;
  }>,
  reply: FastifyReply
) => {
  const chatAttendanceInactivityViewerUseCase = container.resolve(
    ChatAttendanceInactivityViewerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await chatAttendanceInactivityViewerUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.params,
      tokenJwtData.channels
    );

    return sendResponse(reply, {
      message: t('chat_attendance_inactivity_view_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
