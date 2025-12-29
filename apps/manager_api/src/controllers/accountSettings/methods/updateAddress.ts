import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
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
    handleControllerError(error, reply, t);
  }
};
