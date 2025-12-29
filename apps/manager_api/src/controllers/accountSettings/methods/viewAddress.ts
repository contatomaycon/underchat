import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { AccountSettingsAddressViewerUseCase } from '@core/useCases/accountSettings/AccountSettingsAddressViewer.useCase';

export const viewAddress = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const accountSettingsAddressViewerUseCase = container.resolve(
    AccountSettingsAddressViewerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await accountSettingsAddressViewerUseCase.execute(
      t,
      tokenJwtData.user_id
    );

    return sendResponse(reply, {
      message: t('user_address_view_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
