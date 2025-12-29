import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { CreateExpenditureRequest } from '@core/schema/expenditure/createExpenditure/request.schema';
import { ExpenditureCreatorUseCase } from '@core/useCases/expenditure/ExpenditureCreator.useCase';

export const createExpenditure = async (
  request: FastifyRequest<{
    Body: CreateExpenditureRequest;
  }>,
  reply: FastifyReply
) => {
  const expenditureCreatorUseCase = container.resolve(
    ExpenditureCreatorUseCase
  );
  const { t } = request;

  try {
    const response = await expenditureCreatorUseCase.execute(t, request.body);

    if (response) {
      return sendResponse(reply, {
        message: t('expenditure_creator_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('expenditure_creator_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
