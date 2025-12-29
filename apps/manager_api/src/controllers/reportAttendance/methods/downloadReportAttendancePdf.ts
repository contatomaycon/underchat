import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ListReportAttendanceRequest } from '@core/schema/reportAttendance/listReportAttendance/request.schema';
import { ReportAttendancePdfGeneratorUseCase } from '@core/useCases/reportAttendance/ReportAttendancePdfGenerator.useCase';

export const downloadReportAttendancePdf = async (
  request: FastifyRequest<{
    Querystring: ListReportAttendanceRequest;
  }>,
  reply: FastifyReply
) => {
  const reportAttendancePdfGeneratorUseCase = container.resolve(
    ReportAttendancePdfGeneratorUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const pdfBuffer = await reportAttendancePdfGeneratorUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.query
    );

    const filename = `relatorio-atendimentos-${new Date().toISOString().split('T')[0]}.pdf`;

    reply
      .code(EHTTPStatusCode.ok)
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(pdfBuffer);
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
