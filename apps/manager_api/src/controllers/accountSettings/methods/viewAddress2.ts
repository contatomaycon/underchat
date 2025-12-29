import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
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
    handleControllerError(error, reply, t);
  }
};
