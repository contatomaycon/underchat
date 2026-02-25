import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ViewAttendanceHoursUseCase } from '@core/useCases/worker/ViewAttendanceHours.useCase';
import { ViewAttendanceHoursParams } from '@core/schema/worker/viewAttendanceHours/request.schema';

export const viewAttendanceHours = async (
  request: FastifyRequest<{
    Params: ViewAttendanceHoursParams;
  }>,
  reply: FastifyReply
) => {
  const viewAttendanceHoursUseCase = container.resolve(
    ViewAttendanceHoursUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await viewAttendanceHoursUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.params.worker_id
    );

    return sendResponse(reply, {
      message: t('attendance_hours_view_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
