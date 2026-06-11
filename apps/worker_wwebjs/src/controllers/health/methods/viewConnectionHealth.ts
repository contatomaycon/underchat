import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { WwebjsService } from '@core/services/wwebjs';
import {
  getKafkaConsumerHealthSnapshots,
  hasUnhealthyKafkaConsumer,
} from '@/consumer/registry';

export const viewConnectionHealth = async (
  _request: FastifyRequest,
  reply: FastifyReply
) => {
  const wwebjsService = container.resolve(WwebjsService);
  const isConnected = wwebjsService.isConnected();
  const kafkaUnhealthy = hasUnhealthyKafkaConsumer();
  const data = {
    connected: isConnected,
    kafka_unhealthy: kafkaUnhealthy,
    kafka_consumers: getKafkaConsumerHealthSnapshots(),
  };

  if (isConnected && !kafkaUnhealthy) {
    return sendResponse(reply, {
      httpStatusCode: EHTTPStatusCode.ok,
      data,
    });
  }

  return sendResponse(reply, {
    httpStatusCode: EHTTPStatusCode.service_unavailable,
    data,
  });
};
