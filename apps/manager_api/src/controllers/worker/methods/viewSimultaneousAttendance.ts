import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ViewSimultaneousAttendanceUseCase } from '@core/useCases/worker/ViewSimultaneousAttendance.useCase';
import { ViewSimultaneousAttendanceParams } from '@core/schema/worker/viewSimultaneousAttendance/request.schema';

export const viewSimultaneousAttendance = async (
  request: FastifyRequest<{
    Params: ViewSimultaneousAttendanceParams;
  }>,
  reply: FastifyReply
) => {
  const viewSimultaneousAttendanceUseCase = container.resolve(
    ViewSimultaneousAttendanceUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await viewSimultaneousAttendanceUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.params.worker_id
    );

    return sendResponse(reply, {
      message: t('simultaneous_attendance_view_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
