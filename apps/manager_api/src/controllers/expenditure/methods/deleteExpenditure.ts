import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { DeleteExpenditureRequest } from '@core/schema/expenditure/deleteExpenditure/request.schema';
import { ExpenditureDeleterUseCase } from '@core/useCases/expenditure/ExpenditureDeleter.useCase';

export const deleteExpenditure = async (
  request: FastifyRequest<{
    Params: DeleteExpenditureRequest;
  }>,
  reply: FastifyReply
) => {
  const expenditureDeleterUseCase = container.resolve(
    ExpenditureDeleterUseCase
  );
  const { t } = request;

  try {
    const response = await expenditureDeleterUseCase.execute(
      t,
      request.params.expenditure_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('expenditure_deleted_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }


    return sendResponse(reply, {
      message: t('expenditure_deleter_error'),
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
