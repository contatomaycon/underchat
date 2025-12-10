import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { UpdateAdditionalInfoRequest } from '@core/schema/accountSettings/updateAdditionalInfo/request.schema';
import { AccountSettingsAdditionalInfoUpdaterUseCase } from '@core/useCases/accountSettings/AccountSettingsAdditionalInfoUpdater.useCase';

export const updateAdditionalInfo = async (
  request: FastifyRequest<{
    Body: UpdateAdditionalInfoRequest;
  }>,
  reply: FastifyReply
) => {
  const accountSettingsAdditionalInfoUpdaterUseCase = container.resolve(
    AccountSettingsAdditionalInfoUpdaterUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await accountSettingsAdditionalInfoUpdaterUseCase.execute(
      t,
      tokenJwtData.user_id,
      request.body
    );

    return sendResponse(reply, {
      message: t('user_info_update_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    console.error(error);

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
