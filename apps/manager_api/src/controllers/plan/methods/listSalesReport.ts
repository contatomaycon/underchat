import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ListSalesReportRequest } from '@core/schema/plan/listSalesReport/request.schema';
import { SalesReportListerUseCase } from '@core/useCases/plan/SalesReportLister.useCase';

export const listSalesReport = async (
  request: FastifyRequest<{
    Querystring: ListSalesReportRequest;
  }>,
  reply: FastifyReply
) => {
  const salesReportListerUseCase = container.resolve(SalesReportListerUseCase);
  const { t } = request;

  try {
    const response = await salesReportListerUseCase.execute(t, request.query);

    if (response) {
      return sendResponse(reply, {
        message: t('sales_report_list_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    request.server.logger.info(response, request.id);

    return sendResponse(reply, {
      message: t('sales_report_list_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
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
