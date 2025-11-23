import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import {
  UpdateExpenditureRequest,
  UpdateExpenditureParamsRequest,
} from '@core/schema/expenditure/updateExpenditure/request.schema';
import { ExpenditureUpdaterUseCase } from '@core/useCases/expenditure/ExpenditureUpdater.useCase';

export const updateExpenditure = async (
  request: FastifyRequest<{
    Params: UpdateExpenditureParamsRequest;
    Body: UpdateExpenditureRequest;
  }>,
  reply: FastifyReply
) => {
  const expenditureUpdaterUseCase = container.resolve(
    ExpenditureUpdaterUseCase
  );
  const { t } = request;

  try {
    const response = await expenditureUpdaterUseCase.execute(
      t,
      request.params.expenditure_id,
      request.body
    );

    if (response) {
      return sendResponse(reply, {
        message: t('expenditure_updated_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    request.server.logger.info(response, request.id);

    return sendResponse(reply, {
      message: t('expenditure_update_failed'),
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
