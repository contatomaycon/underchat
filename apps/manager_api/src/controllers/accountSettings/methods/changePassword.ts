import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { AccountSettingsPasswordChangerUseCase } from '@core/useCases/accountSettings/AccountSettingsPasswordChanger.useCase';
import { ChangePasswordRequest } from '@core/schema/accountSettings/changePassword/request.schema';

export const changePassword = async (
  request: FastifyRequest<{ Body: ChangePasswordRequest }>,
  reply: FastifyReply
) => {
  const accountSettingsPasswordChangerUseCase = container.resolve(
    AccountSettingsPasswordChangerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await accountSettingsPasswordChangerUseCase.execute(
      t,
      tokenJwtData.user_id,
      tokenJwtData.account_id,
      request.body
    );

    return sendResponse(reply, {
      message: t('password_change_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
