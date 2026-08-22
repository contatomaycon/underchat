import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { hasKafkaConsumerRequiringProcessReplacement } from '@/consumer/registry';
import { hasWwebjsProviderProcessReplacementRequirement } from '@core/common/functions/wwebjsProcessReplacement';

export const viewHealth = async (
  _request: FastifyRequest,
  reply: FastifyReply
) => {
  const kafkaProcessReplacementRequired =
    hasKafkaConsumerRequiringProcessReplacement();
  const providerProcessReplacementRequired =
    hasWwebjsProviderProcessReplacementRequirement();
  const processReplacementRequired =
    kafkaProcessReplacementRequired || providerProcessReplacementRequired;
  return sendResponse(reply, {
    httpStatusCode: processReplacementRequired
      ? EHTTPStatusCode.service_unavailable
      : EHTTPStatusCode.ok,
    data: {
      alive: !processReplacementRequired,
      kafka_process_replacement_required: kafkaProcessReplacementRequired,
      provider_process_replacement_required: providerProcessReplacementRequired,
    },
  });
};
