import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { AccountPaymentsListerUseCase } from '@core/useCases/account/AccountPaymentsLister.useCase';
import {
  ListAccountPaymentsRequest,
  ListAccountPaymentsParams,
} from '@core/schema/account/listAccountPayments/request.schema';

export const listAccountPayments = async (
  request: FastifyRequest<{
    Params: ListAccountPaymentsParams;
    Querystring: ListAccountPaymentsRequest;
  }>,
  reply: FastifyReply
) => {
  const accountPaymentsListerUseCase = container.resolve(
    AccountPaymentsListerUseCase
  );
  const { t, params, query } = request;

  try {
    const response = await accountPaymentsListerUseCase.execute(
      params.account_id,
      query
    );

    return sendResponse(reply, {
      message: t('account_payments_listed_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
