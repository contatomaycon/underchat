import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ViewUserEmailRequest } from '@core/schema/user/viewUserEmail/request.schema';
import { UserEmailViewerUseCase } from '@core/useCases/user/UserEmailViewer.useCase';

export const viewUserEmail = async (
  request: FastifyRequest<{
    Params: ViewUserEmailRequest;
  }>,
  reply: FastifyReply
) => {
  const userEmailViewerUseCase = container.resolve(UserEmailViewerUseCase);
  const { t } = request;

  try {
    const response = await userEmailViewerUseCase.execute(
      t,
      request.params.user_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('user_email_view_successfully'),
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
