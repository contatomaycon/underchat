import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { buildEnvironment } from '@core/config/environments';
import { isServiceApiKafkaBootstrapCutoverEnabled } from '@core/common/functions/serviceApiKafkaCutoverBarrier';
import {
  getServiceApiConsumerStartupState,
  getServiceApiKafkaConsumersRequiringPodReplacement,
  getServiceApiKafkaHealthSnapshots,
  hasServiceApiConsumerStartupFailed,
  hasUnreadyServiceApiKafkaConsumer,
  hasUnhealthyServiceApiKafkaConsumer,
  isServiceApiConsumerStartupPending,
} from '@/consumer/registry';

interface IKafkaAwareHealthOptions {
  failOnKafkaUnhealthy: boolean;
  requireKafkaReady?: boolean;
  allowConsumerStartupPending?: boolean;
}

async function sendKafkaAwareHealth(
  reply: FastifyReply,
  options: IKafkaAwareHealthOptions
) {
  const consumerStartupState = getServiceApiConsumerStartupState();
  const kafkaConsumers = getServiceApiKafkaHealthSnapshots();
  const kafkaUnhealthy = hasUnhealthyServiceApiKafkaConsumer();
  const kafkaReady =
    consumerStartupState === 'ready' && !hasUnreadyServiceApiKafkaConsumer();
  const consumerStartupPending = isServiceApiConsumerStartupPending();
  const consumerStartupFailed = hasServiceApiConsumerStartupFailed();
  const kafkaStateShouldFail = options.requireKafkaReady
    ? !kafkaReady
    : kafkaUnhealthy && options.failOnKafkaUnhealthy;
  const shouldFail =
    consumerStartupFailed ||
    (consumerStartupPending
      ? options.allowConsumerStartupPending !== true
      : kafkaStateShouldFail);

  return sendResponse(reply, {
    httpStatusCode: shouldFail
      ? EHTTPStatusCode.service_unavailable
      : EHTTPStatusCode.ok,
    data: {
      consumer_startup_state: consumerStartupState,
      consumer_startup_pending: consumerStartupPending,
      consumer_startup_failed: consumerStartupFailed,
      kafka_ready: kafkaReady,
      kafka_unhealthy: kafkaUnhealthy,
      kafka_consumers: kafkaConsumers,
    },
  });
}

export const viewHealth = async (
  _request: FastifyRequest,
  reply: FastifyReply
) => {
  return sendKafkaAwareHealth(reply, {
    failOnKafkaUnhealthy: buildEnvironment.serviceApiHealthFailOnKafkaUnhealthy,
  });
};

export const viewReadiness = async (
  _request: FastifyRequest,
  reply: FastifyReply
) => {
  return sendKafkaAwareHealth(reply, {
    failOnKafkaUnhealthy: true,
    requireKafkaReady: true,
    // A destructive bootstrap cutover needs old members to leave before new
    // consumers can start. Normal rollouts must not receive traffic until all
    // Kafka consumers are actually ready.
    allowConsumerStartupPending: isServiceApiKafkaBootstrapCutoverEnabled(),
  });
};

export const viewLiveness = async (
  _request: FastifyRequest,
  reply: FastifyReply
) => {
  const replacementConsumers =
    getServiceApiKafkaConsumersRequiringPodReplacement();
  const kafkaPodReplacementRequired = replacementConsumers.length > 0;
  const consumerStartupFailed = hasServiceApiConsumerStartupFailed();
  const processReplacementRequired =
    consumerStartupFailed || kafkaPodReplacementRequired;

  return sendResponse(reply, {
    httpStatusCode: processReplacementRequired
      ? EHTTPStatusCode.service_unavailable
      : EHTTPStatusCode.ok,
    data: {
      alive: !processReplacementRequired,
      consumer_startup_failed: consumerStartupFailed,
      kafka_pod_replacement_required: kafkaPodReplacementRequired,
      kafka_replacement_consumers: replacementConsumers.map((snapshot) => ({
        owner: snapshot.owner,
        topics: snapshot.topics,
        assigned_topics: snapshot.assigned_topics,
        stall_reason: snapshot.stall_reason,
        last_error: snapshot.last_error,
        restart_count: snapshot.restart_count,
        consecutive_stall_restart_count:
          snapshot.consecutive_stall_restart_count,
        stall_recovery_exhausted: snapshot.stall_recovery_exhausted,
        health_snapshot_recovery_exhausted:
          snapshot.health_snapshot_recovery_exhausted,
        health_snapshot_missing_age_ms: snapshot.health_snapshot_missing_age_ms,
        health_snapshot_recovery_timeout_ms:
          snapshot.health_snapshot_recovery_timeout_ms,
      })),
    },
  });
};
