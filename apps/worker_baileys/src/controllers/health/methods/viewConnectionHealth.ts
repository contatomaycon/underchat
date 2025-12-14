import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { BaileysService } from '@core/services/baileys';

export const viewConnectionHealth = async (
  _request: FastifyRequest,
  reply: FastifyReply
) => {
  const baileysService = container.resolve(BaileysService);
  const isConnected = baileysService.isConnected();

  if (isConnected) {
    return sendResponse(reply, {
      httpStatusCode: EHTTPStatusCode.ok,
    });
  }

  return sendResponse(reply, {
    httpStatusCode: EHTTPStatusCode.service_unavailable,
  });
};
