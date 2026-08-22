import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import {
  UpdateChatAttendanceInactivityParams,
  UpdateChatAttendanceInactivityRequest,
} from '@core/schema/chat/updateChatAttendanceInactivity/request.schema';
import { ChatAttendanceInactivityUpdaterUseCase } from '@core/useCases/chat/ChatAttendanceInactivityUpdater.useCase';

export const updateChatAttendanceInactivity = async (
  request: FastifyRequest<{
    Params: UpdateChatAttendanceInactivityParams;
    Body: UpdateChatAttendanceInactivityRequest;
  }>,
  reply: FastifyReply
) => {
  const chatAttendanceInactivityUpdaterUseCase = container.resolve(
    ChatAttendanceInactivityUpdaterUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await chatAttendanceInactivityUpdaterUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.params,
      request.body,
      tokenJwtData.channels
    );

    if (response) {
      return sendResponse(reply, {
        message: t('chat_attendance_inactivity_update_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: { success: true },
      });
    }

    return sendResponse(reply, {
      message: t('chat_attendance_inactivity_update_failed'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
