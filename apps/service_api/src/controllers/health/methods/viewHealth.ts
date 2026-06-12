import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { buildEnvironment } from '@core/config/environments';
import {
  getServiceApiKafkaHealthSnapshots,
  hasUnhealthyServiceApiKafkaConsumer,
} from '@/consumer/registry';

export const viewHealth = async (
  _request: FastifyRequest,
  reply: FastifyReply
) => {
  const kafkaConsumers = getServiceApiKafkaHealthSnapshots();
  const kafkaUnhealthy = hasUnhealthyServiceApiKafkaConsumer();
  const shouldFail =
    kafkaUnhealthy && buildEnvironment.serviceApiHealthFailOnKafkaUnhealthy;

  return sendResponse(reply, {
    httpStatusCode: shouldFail
      ? EHTTPStatusCode.service_unavailable
      : EHTTPStatusCode.ok,
    data: {
      kafka_unhealthy: kafkaUnhealthy,
      kafka_consumers: kafkaConsumers,
    },
  });
};
