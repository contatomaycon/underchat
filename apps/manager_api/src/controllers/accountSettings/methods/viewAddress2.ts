import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { AccountSettingsAddress2ViewerUseCase } from '@core/useCases/accountSettings/AccountSettingsAddress2Viewer.useCase';

export const viewAddress2 = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const accountSettingsAddress2ViewerUseCase = container.resolve(
    AccountSettingsAddress2ViewerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await accountSettingsAddress2ViewerUseCase.execute(
      t,
      tokenJwtData.user_id
    );

    return sendResponse(reply, {
      message: t('user_address2_view_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    request.server.logger.error(error, request.id);

    if (error instanceof Error) {
      return sendResponse(reply, {
        message: error.message,
        httpStatusCode: EHTTPStatusCode.bad_request,
      });
    }

    return sendResponse(reply, {
      message: t('internal_server_error'),
      httpStatusCode: EHTTPStatusCode.internal_server_error,
    });
  }
};
