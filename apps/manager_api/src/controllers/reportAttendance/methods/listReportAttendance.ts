import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
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
    handleControllerError(error, reply, t);
  }
};
