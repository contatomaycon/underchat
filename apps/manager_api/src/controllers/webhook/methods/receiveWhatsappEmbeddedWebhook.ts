import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import {
  WhatsappEmbeddedWebhookAuthError,
  WhatsappEmbeddedWebhookUseCase,
} from '@core/useCases/webhook/WhatsappEmbeddedWebhook.useCase';

type RawBodyRequest = FastifyRequest & {
  rawBody?: Buffer;
};

export const receiveWhatsappEmbeddedWebhook = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const whatsappEmbeddedWebhookUseCase = container.resolve(
    WhatsappEmbeddedWebhookUseCase
  );
  const { t } = request;
  const rawBody = (request as RawBodyRequest).rawBody;

  if (!rawBody) {
    return sendResponse(reply, {
      message: t('whatsapp_embedded_webhook_raw_body_missing'),
      httpStatusCode: EHTTPStatusCode.bad_request,
      data: { success: false },
    });
  }

  try {
    const result = await whatsappEmbeddedWebhookUseCase.receive(t, {
      body: request.body,
      rawBody,
      signatureHeader: request.headers['x-hub-signature-256'] as
        string | undefined,
    });

    return sendResponse(reply, {
      message: t('whatsapp_embedded_webhook_received_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: { success: true, ignored: result.ignored },
    });
  } catch (error) {
    if (error instanceof WhatsappEmbeddedWebhookAuthError) {
      return sendResponse(reply, {
        message: error.message,
        httpStatusCode: EHTTPStatusCode.forbidden,
        data: { success: false },
      });
    }

    handleControllerError(error, reply, t);
  }
};
