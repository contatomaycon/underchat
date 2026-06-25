import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { WwebjsHealthCheckService } from '@core/services/wwebjs/methods/healthCheck.service';
import {
  getKafkaConsumerHealthSnapshots,
  hasUnhealthyKafkaConsumer,
} from '@/consumer/registry';

const FAIL_ON_KAFKA_UNHEALTHY =
  process.env.WORKER_CONNECTION_HEALTH_FAIL_ON_KAFKA_UNHEALTHY === 'true';

export const viewConnectionHealth = async (
  _request: FastifyRequest,
  reply: FastifyReply
) => {
  const healthCheckService = container.resolve(WwebjsHealthCheckService);
  const readiness = await healthCheckService.verifyCurrentSession();
  const sessionReady = readiness.session_ready === true;
  const kafkaUnhealthy = hasUnhealthyKafkaConsumer();
  const data = {
    ...readiness,
    connected: sessionReady,
    ready: sessionReady,
    kafka_unhealthy: kafkaUnhealthy,
    kafka_consumers: getKafkaConsumerHealthSnapshots(),
  };

  if (sessionReady && (!kafkaUnhealthy || !FAIL_ON_KAFKA_UNHEALTHY)) {
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
