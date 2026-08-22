import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { canOperateOnOtherAccounts } from '@core/common/functions/hasFullAccess';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ViewAttendanceHoursRequest } from '@core/schema/user/viewAttendanceHours/request.schema';
import { UserAttendanceHoursViewerUseCase } from '@core/useCases/user/UserAttendanceHoursViewer.useCase';

export const viewAttendanceHours = async (
  request: FastifyRequest<{
    Params: ViewAttendanceHoursRequest;
  }>,
  reply: FastifyReply
) => {
  const userAttendanceHoursViewerUseCase = container.resolve(
    UserAttendanceHoursViewerUseCase
  );
  const { t, tokenJwtData } = request;
  const canOperateOnOthers = canOperateOnOtherAccounts(tokenJwtData.actions);

  try {
    const response = await userAttendanceHoursViewerUseCase.execute(
      t,
      request.params.user_id,
      tokenJwtData.account_id,
      canOperateOnOthers
    );

    return sendResponse(reply, {
      message: t('user_attendance_hours_view_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
