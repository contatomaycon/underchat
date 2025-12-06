import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { PaymentWebhookUseCase } from '@core/useCases/Webhook/PaymentWebhook.useCase';
import { AsaasPaymentWebhookRequest } from '@core/schema/payment/Webhook/request.schema';
import { asaasEnvironment } from '@core/config/environments';

export const webhook = async (
  request: FastifyRequest<{ Body: AsaasPaymentWebhookRequest }>,
  reply: FastifyReply
) => {
  const receivedToken = request.headers['asaas-access-token'] as string;
  const expectedToken = asaasEnvironment.getAsaasWebhook();

  if (!receivedToken || receivedToken !== expectedToken) {
    return sendResponse(reply, {
      message: 'Token de autenticação inválido',
      httpStatusCode: EHTTPStatusCode.unauthorized,
      data: { success: false },
    });
  }

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
