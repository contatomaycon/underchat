import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ListRegisterStatesRequest } from '@core/schema/register/listStates/request.schema';
import { ListStatesUseCase } from '@core/useCases/zipcode/ListStates.useCase';

export const listStates = async (
  request: FastifyRequest<{
    Querystring: ListRegisterStatesRequest;
  }>,
  reply: FastifyReply
) => {
  const listStatesUseCase = container.resolve(ListStatesUseCase);
  const { t } = request;

  try {
    const response = await listStatesUseCase.execute(request.query);

    return sendResponse(reply, {
      message: t('states_listed_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
