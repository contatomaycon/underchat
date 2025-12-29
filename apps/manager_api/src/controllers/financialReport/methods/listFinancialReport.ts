import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ListFinancialReportRequest } from '@core/schema/financialReport/listFinancialReport/request.schema';
import { FinancialReportListerUseCase } from '@core/useCases/financialReport/FinancialReportLister.useCase';

export const listFinancialReport = async (
  request: FastifyRequest<{
    Querystring: ListFinancialReportRequest;
  }>,
  reply: FastifyReply
) => {
  const financialReportListerUseCase = container.resolve(
    FinancialReportListerUseCase
  );
  const { t } = request;

  try {
    const response = await financialReportListerUseCase.execute(
      t,
      request.query
    );

    if (response) {
      return sendResponse(reply, {
        message: t('financial_report_list_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('financial_report_list_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
