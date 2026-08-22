import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { hasKafkaConsumerRequiringProcessReplacement } from '@/consumer/registry';

export const viewHealth = async (
  _request: FastifyRequest,
  reply: FastifyReply
) => {
  const processReplacementRequired =
    hasKafkaConsumerRequiringProcessReplacement();
  return sendResponse(reply, {
    httpStatusCode: processReplacementRequired
      ? EHTTPStatusCode.service_unavailable
      : EHTTPStatusCode.ok,
    data: {
      alive: !processReplacementRequired,
      kafka_process_replacement_required: processReplacementRequired,
    },
  });
};
