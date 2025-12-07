import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { NfseWebhookUseCase } from '@core/useCases/Webhook/NfseWebhook.useCase';
import { AsaasNfseWebhookRequest } from '@core/schema/nfse/Webhook/request.schema';
import { asaasEnvironment } from '@core/config/environments';

export const nfseWebhook = async (
  request: FastifyRequest<{ Body: AsaasNfseWebhookRequest }>,
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

  const nfseWebhookUseCase = container.resolve(NfseWebhookUseCase);

  try {
    await nfseWebhookUseCase.execute(request.body);

    return sendResponse(reply, {
      message: 'Webhook de nota fiscal recebido com sucesso',
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
      message: 'Erro ao processar webhook de nota fiscal',
      httpStatusCode: EHTTPStatusCode.internal_server_error,
      data: { success: false },
    });
  }
};
