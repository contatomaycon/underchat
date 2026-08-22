import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ViewUserPhoneRequest } from '@core/schema/user/viewUserPhone/request.schema';
import { UserPhoneViewerUseCase } from '@core/useCases/user/UserPhoneViewer.useCase';

export const viewUserPhone = async (
  request: FastifyRequest<{
    Params: ViewUserPhoneRequest;
  }>,
  reply: FastifyReply
) => {
  const userPhoneViewerUseCase = container.resolve(UserPhoneViewerUseCase);
  const { t } = request;

  try {
    const response = await userPhoneViewerUseCase.execute(
      t,
      request.params.user_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('user_phone_view_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('user_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
