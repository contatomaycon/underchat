import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ViewZipcodeRequest } from '@core/schema/zipcode/viewZipcode/request.schema';
import { ZipcodeViewerUseCase } from '@core/useCases/zipcode/ZipcodeViewer.useCase';

export const getZipcode = async (
  request: FastifyRequest<{
    Querystring: ViewZipcodeRequest;
  }>,
  reply: FastifyReply
) => {
  const zipcodeViewerUseCase = container.resolve(ZipcodeViewerUseCase);
  const { t } = request;

  try {
    const response = await zipcodeViewerUseCase.execute(request.query);

    if (response) {
      return sendResponse(reply, {
        message: t('zipcode_view_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    request.server.logger.info(response, request.id);

    return sendResponse(reply, {
      message: t('zipcode_not_found'),
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
