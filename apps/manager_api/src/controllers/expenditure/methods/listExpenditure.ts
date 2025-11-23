import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ListExpenditureRequest } from '@core/schema/expenditure/listExpenditure/request.schema';
import { ExpenditureListerUseCase } from '@core/useCases/expenditure/ExpenditureLister.useCase';

export const listExpenditure = async (
  request: FastifyRequest<{
    Querystring: ListExpenditureRequest;
  }>,
  reply: FastifyReply
) => {
  const expenditureListerUseCase = container.resolve(ExpenditureListerUseCase);
  const { t } = request;

  try {
    const response = await expenditureListerUseCase.execute(t, request.query);

    if (response) {
      return sendResponse(reply, {
        message: t('expenditure_list_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    request.server.logger.info(response, request.id);

    return sendResponse(reply, {
      message: t('expenditure_list_not_found'),
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
