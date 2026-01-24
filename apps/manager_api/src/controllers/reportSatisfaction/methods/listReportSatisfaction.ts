import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ListReportSatisfactionRequest } from '@core/schema/reportSatisfaction/listReportSatisfaction/request.schema';
import { ReportSatisfactionListerUseCase } from '@core/useCases/reportSatisfaction/ReportSatisfactionLister.useCase';

export const listReportSatisfaction = async (
  request: FastifyRequest<{
    Querystring: ListReportSatisfactionRequest;
  }>,
  reply: FastifyReply
) => {
  const reportSatisfactionListerUseCase = container.resolve(
    ReportSatisfactionListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await reportSatisfactionListerUseCase.execute(
      tokenJwtData.account_id,
      request.query
    );

    return sendResponse(reply, {
      message: t('report_satisfaction_list_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
