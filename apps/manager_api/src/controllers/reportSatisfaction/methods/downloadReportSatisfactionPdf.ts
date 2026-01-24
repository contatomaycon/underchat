import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { DownloadReportSatisfactionPdfRequest } from '@core/schema/reportSatisfaction/downloadReportSatisfactionPdf/request.schema';
import { ReportSatisfactionPdfGeneratorUseCase } from '@core/useCases/reportSatisfaction/ReportSatisfactionPdfGenerator.useCase';

export const downloadReportSatisfactionPdf = async (
  request: FastifyRequest<{
    Querystring: DownloadReportSatisfactionPdfRequest;
  }>,
  reply: FastifyReply
) => {
  const reportSatisfactionPdfGeneratorUseCase = container.resolve(
    ReportSatisfactionPdfGeneratorUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const pdfBuffer = await reportSatisfactionPdfGeneratorUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.query
    );

    const filename = `relatorio-satisfacao-${new Date().toISOString().split('T')[0]}.pdf`;

    reply
      .code(EHTTPStatusCode.ok)
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(pdfBuffer);
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
