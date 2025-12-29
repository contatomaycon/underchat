import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { AccountCustomizationUpserterUseCase } from '@core/useCases/accountSettings/AccountCustomizationUpserter.useCase';
import { UpsertAccountCustomizationRequest } from '@core/schema/accountSettings/upsertAccountCustomization/request.schema';

export const upsertAccountCustomization = async (
  request: FastifyRequest<{
    Body: UpsertAccountCustomizationRequest;
  }>,
  reply: FastifyReply
) => {
  const accountCustomizationUpserterUseCase = container.resolve(
    AccountCustomizationUpserterUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await accountCustomizationUpserterUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.body
    );

    if (!response) {
      return sendResponse(reply, {
        message: t('account_info_update_error'),
        httpStatusCode: EHTTPStatusCode.bad_request,
      });
    }

    return sendResponse(reply, {
      message: t('account_info_update_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
