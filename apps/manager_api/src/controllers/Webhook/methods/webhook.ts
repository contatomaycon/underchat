import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { PaymentWebhookUseCase } from '@core/useCases/Webhook/PaymentWebhook.useCase';
import { AsaasPaymentWebhookRequest } from '@core/schema/payment/Webhook/request.schema';

export const webhook = async (
  request: FastifyRequest<{ Body: AsaasPaymentWebhookRequest }>,
  reply: FastifyReply
) => {
  const paymentWebhookUseCase = container.resolve(PaymentWebhookUseCase);

  try {
    await paymentWebhookUseCase.execute(request.body);

    return sendResponse(reply, {
      message: 'Webhook recebido com sucesso',
      httpStatusCode: EHTTPStatusCode.ok,
      data: { success: true },
    });
  } catch (error) {
    request.server.logger.error(error, request.id);

    if (error instanceof Error) {
      return sendResponse(reply, {
        message: error.message,
        httpStatusCode: EHTTPStatusCode.internal_server_error,
        data: { success: false },
      });
    }

    return sendResponse(reply, {
      message: 'Erro ao processar webhook',
      httpStatusCode: EHTTPStatusCode.internal_server_error,
      data: { success: false },
    });
  }
};
