import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
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
