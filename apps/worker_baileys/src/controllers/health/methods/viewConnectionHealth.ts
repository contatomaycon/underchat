import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { BaileysHealthCheckService } from '@core/services/baileys/methods/healthCheck.service';
import {
  getKafkaConsumerHealthSummary,
  getKafkaConsumerHealthSnapshots,
  hasUnhealthyKafkaConsumer,
} from '@/consumer/registry';

const FAIL_ON_KAFKA_UNHEALTHY =
  process.env.WORKER_CONNECTION_HEALTH_FAIL_ON_KAFKA_UNHEALTHY === 'true';

export const viewConnectionHealth = async (
  _request: FastifyRequest,
  reply: FastifyReply
) => {
  const healthCheckService = container.resolve(BaileysHealthCheckService);
  const readiness = await healthCheckService.verifyCurrentSession();
  const sessionReady = readiness.session_ready === true;
  const kafkaUnhealthy = hasUnhealthyKafkaConsumer();
  const data = {
    ...readiness,
    connected: sessionReady,
    ready: sessionReady,
    kafka_unhealthy: kafkaUnhealthy,
    kafka_consumers: getKafkaConsumerHealthSnapshots(),
    kafka_consumer_summary: getKafkaConsumerHealthSummary(),
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
