import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ListCitiesRequest } from '@core/schema/zipcode/listCities/request.schema';
import { ListCitiesUseCase } from '@core/useCases/zipcode/ListCities.useCase';

export const listCities = async (
  request: FastifyRequest<{
    Querystring: ListCitiesRequest;
  }>,
  reply: FastifyReply
) => {
  const listCitiesUseCase = container.resolve(ListCitiesUseCase);
  const { t } = request;

  try {
    const response = await listCitiesUseCase.execute(request.query);

    return sendResponse(reply, {
      message: t('cities_listed_successfully'),
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
