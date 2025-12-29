import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { AccountCustomizationViewerUseCase } from '@core/useCases/accountSettings/AccountCustomizationViewer.useCase';

export const viewAccountCustomization = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const accountCustomizationViewerUseCase = container.resolve(
    AccountCustomizationViewerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await accountCustomizationViewerUseCase.execute(
      t,
      tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('account_info_view_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('account_info_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
