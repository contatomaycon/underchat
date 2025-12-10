import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import {
  EditExpenditureParamsRequest,
  UpdateExpenditureRequest,
} from '@core/schema/expenditure/editExpenditure/request.schema';
import { ExpenditureUpdaterUseCase } from '@core/useCases/expenditure/ExpenditureUpdater.useCase';

export const editExpenditure = async (
  request: FastifyRequest<{
    Params: EditExpenditureParamsRequest;
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
        message: t('expenditure_update_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    return sendResponse(reply, {
      message: t('expenditure_update_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    console.error(error);

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
