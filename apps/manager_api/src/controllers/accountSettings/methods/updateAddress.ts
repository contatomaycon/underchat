import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { UpdateAddressRequest } from '@core/schema/accountSettings/updateAddress/request.schema';
import { AccountSettingsAddressUpdaterUseCase } from '@core/useCases/accountSettings/AccountSettingsAddressUpdater.useCase';

export const updateAddress = async (
  request: FastifyRequest<{
    Body: UpdateAddressRequest;
  }>,
  reply: FastifyReply
) => {
  const accountSettingsAddressUpdaterUseCase = container.resolve(
    AccountSettingsAddressUpdaterUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await accountSettingsAddressUpdaterUseCase.execute(
      t,
      tokenJwtData.user_id,
      request.body
    );

    return sendResponse(reply, {
      message: t('user_address_update_success'),
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
