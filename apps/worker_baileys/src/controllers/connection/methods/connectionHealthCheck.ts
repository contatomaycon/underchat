import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { BaileysService } from '@core/services/baileys';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';

export const connectionHealthCheck = async (
  _request: FastifyRequest,
  reply: FastifyReply
) => {
  const baileysService = container.resolve(BaileysService);

  const status = baileysService.getStatus();

  console.log('Baileys connection status:', status);

  return sendResponse(reply, {
    httpStatusCode:
      status === EBaileysConnectionStatus.connected
        ? EHTTPStatusCode.ok
        : EHTTPStatusCode.internal_server_error,
  });
};
