import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { UserInfoViewerUseCase } from '@core/useCases/plan/UserInfoViewer.useCase';

export const viewUserInfo = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const userInfoViewerUseCase = container.resolve(UserInfoViewerUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await userInfoViewerUseCase.execute(tokenJwtData.user_id);

    if (!response) {
      return sendResponse(reply, {
        message: t('user_info_not_found'),
        httpStatusCode: EHTTPStatusCode.not_found,
      });
    }

    return sendResponse(reply, {
      message: t('user_info_view_successfully'),
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
