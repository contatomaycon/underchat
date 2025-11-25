import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ViewExpenditureRequest } from '@core/schema/expenditure/viewExpenditure/request.schema';
import { ExpenditureViewerUseCase } from '@core/useCases/expenditure/ExpenditureViewer.useCase';

export const viewExpenditure = async (
  request: FastifyRequest<{
    Params: ViewExpenditureRequest;
  }>,
  reply: FastifyReply
) => {
  const expenditureViewerUseCase = container.resolve(ExpenditureViewerUseCase);
  const { t } = request;

  try {
    const response = await expenditureViewerUseCase.execute(
      t,
      request.params.expenditure_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('expenditure_view_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    request.server.logger.info(response, request.id);

    return sendResponse(reply, {
      message: t('expenditure_not_found'),
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
