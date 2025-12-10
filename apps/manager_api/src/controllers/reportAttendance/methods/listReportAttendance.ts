import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ListReportAttendanceRequest } from '@core/schema/reportAttendance/listReportAttendance/request.schema';
import { ReportAttendanceListerUseCase } from '@core/useCases/reportAttendance/ReportAttendanceLister.useCase';

export const listReportAttendance = async (
  request: FastifyRequest<{
    Querystring: ListReportAttendanceRequest;
  }>,
  reply: FastifyReply
) => {
  const reportAttendanceListerUseCase = container.resolve(
    ReportAttendanceListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await reportAttendanceListerUseCase.execute(
      tokenJwtData.account_id,
      request.query
    );

    return sendResponse(reply, {
      message: t('report_attendance_list_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    console.error(error);

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
