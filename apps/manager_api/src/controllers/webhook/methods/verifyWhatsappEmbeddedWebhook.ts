import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import {
  WhatsappEmbeddedWebhookAuthError,
  WhatsappEmbeddedWebhookUseCase,
} from '@core/useCases/webhook/WhatsappEmbeddedWebhook.useCase';

export interface MetaWebhookVerificationQuery {
  'hub.mode'?: string;
  'hub.verify_token'?: string;
  'hub.challenge'?: string;
}

export const verifyWhatsappEmbeddedWebhook = async (
  request: FastifyRequest<{ Querystring: MetaWebhookVerificationQuery }>,
  reply: FastifyReply
) => {
  const whatsappEmbeddedWebhookUseCase = container.resolve(
    WhatsappEmbeddedWebhookUseCase
  );
  const { t } = request;

  try {
    const challenge = await whatsappEmbeddedWebhookUseCase.verify(t, {
      mode: request.query['hub.mode'],
      verifyToken: request.query['hub.verify_token'],
      challenge: request.query['hub.challenge'],
    });

    if (!challenge) {
      return sendResponse(reply, {
        message: t('whatsapp_embedded_webhook_verification_invalid'),
        httpStatusCode: EHTTPStatusCode.forbidden,
        data: { success: false },
      });
    }

    return reply.code(EHTTPStatusCode.ok).type('text/plain').send(challenge);
  } catch (error) {
    const message =
      error instanceof WhatsappEmbeddedWebhookAuthError
        ? error.message
        : t('whatsapp_embedded_webhook_verification_invalid');

    return sendResponse(reply, {
      message,
      httpStatusCode: EHTTPStatusCode.forbidden,
      data: { success: false },
    });
  }
};
