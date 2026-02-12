import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { InvoiceWebhookUseCase } from '@core/useCases/webhook/InvoiceWebhook.useCase';
import { AsaasInvoiceWebhookRequest } from '@core/schema/payment/Webhook/request.schema';
import { asaasEnvironment } from '@core/config/environments';

export const invoiceWebhook = async (
  request: FastifyRequest<{ Body: AsaasInvoiceWebhookRequest }>,
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

  const invoiceWebhookUseCase = container.resolve(InvoiceWebhookUseCase);

  try {
    await invoiceWebhookUseCase.execute(request.body);

    return sendResponse(reply, {
      message: 'Webhook recebido com sucesso',
      httpStatusCode: EHTTPStatusCode.ok,
      data: { success: true },
    });
  } catch (error) {
    handleControllerError(error, reply);
  }
};
