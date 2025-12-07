import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
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
    request.server.logger.error(error, request.id);

    if (error instanceof Error) {
      return reply.code(EHTTPStatusCode.internal_server_error).send({
        message: error.message,
      });
    }

    return reply.code(EHTTPStatusCode.internal_server_error).send({
      message: t('internal_server_error'),
    });
  }
};
