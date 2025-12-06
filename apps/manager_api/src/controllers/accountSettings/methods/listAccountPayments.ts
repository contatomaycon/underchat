import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { AccountPaymentsListerUseCase } from '@core/useCases/accountSettings/AccountPaymentsLister.useCase';
import { ListAccountPaymentsRequest } from '@core/schema/accountSettings/listAccountPayments/request.schema';

export const listAccountPayments = async (
  request: FastifyRequest<{
    Querystring: ListAccountPaymentsRequest;
  }>,
  reply: FastifyReply
) => {
  const accountPaymentsListerUseCase = container.resolve(
    AccountPaymentsListerUseCase
  );
  const { t, tokenJwtData, query } = request;

  try {
    const response = await accountPaymentsListerUseCase.execute(
      tokenJwtData.account_id,
      query
    );

    return sendResponse(reply, {
      message: t('account_payments_listed_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    request.server.logger.error(error, request.id);

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
