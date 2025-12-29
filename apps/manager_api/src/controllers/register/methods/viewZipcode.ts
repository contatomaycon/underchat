import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ViewRegisterZipcodeRequest } from '@core/schema/register/viewZipcode/request.schema';
import { ZipcodeViewerUseCase } from '@core/useCases/zipcode/ZipcodeViewer.useCase';

export const viewZipcode = async (
  request: FastifyRequest<{
    Querystring: ViewRegisterZipcodeRequest;
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

    return sendResponse(reply, {
      message: t('zipcode_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
