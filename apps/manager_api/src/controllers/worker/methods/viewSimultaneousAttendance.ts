import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
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
      tokenJwtData.is_administrator,
      request.params.worker_id
    );

    return sendResponse(reply, {
      message: t('simultaneous_attendance_view_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    request.server.logger.error(error, request.id);

    if (error instanceof Error) {
      return sendResponse(reply, {
        message: error.message,
        httpStatusCode: EHTTPStatusCode.internal_server_error,
      });
    }

    return sendResponse(reply, {
      message: t('internal_server_error'),
      httpStatusCode: EHTTPStatusCode.internal_server_error,
    });
  }
};
