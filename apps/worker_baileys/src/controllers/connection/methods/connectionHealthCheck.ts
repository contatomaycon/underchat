import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ConnectionHealthCheckUseCase } from '@core/useCases/connection/ConnectionHealthCheck.useCase';

export const connectionHealthCheck = async (
  _request: FastifyRequest,
  reply: FastifyReply
) => {
  const connectionHealthCheckUseCase = container.resolve(
    ConnectionHealthCheckUseCase
  );

  const response = await connectionHealthCheckUseCase.execute();

  return sendResponse(reply, response);
};
