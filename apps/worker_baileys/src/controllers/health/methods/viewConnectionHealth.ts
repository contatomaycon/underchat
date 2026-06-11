import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { BaileysService } from '@core/services/baileys';
import {
  getKafkaConsumerHealthSnapshots,
  hasUnhealthyKafkaConsumer,
} from '@/consumer/registry';

export const viewConnectionHealth = async (
  _request: FastifyRequest,
  reply: FastifyReply
) => {
  const baileysService = container.resolve(BaileysService);
  const isConnected = baileysService.isConnected();
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
