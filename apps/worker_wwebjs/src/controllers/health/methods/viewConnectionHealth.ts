import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { WwebjsHealthCheckService } from '@core/services/wwebjs/methods/healthCheck.service';
import { WwebjsConnectionService } from '@core/services/wwebjs/methods/connection.service';
import {
  areKafkaConsumersReady,
  getKafkaConsumerHealthSummary,
  getKafkaConsumerHealthSnapshots,
} from '@/consumer/registry';
import { isWorkerKafkaDispatchAuthorized } from '@core/common/functions/workerKafkaDispatchAuthorization';
import { isWhatsappConnectionOnline } from '@core/common/functions/whatsappConnectionStatus';
import { wwebjsEnvironment } from '@core/config/environments';
import { EWorkerType } from '@core/common/enums/EWorkerType';

export const viewConnectionHealth = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const healthCheckService = container.resolve(WwebjsHealthCheckService);
  const connectionService = container.resolve(WwebjsConnectionService);
  const readiness = await healthCheckService.verifyCurrentSession();
  const hasSession = connectionService.hasSession();
  const qrStreamReady = request.server?.qrStreamReady === true;
  const runtimeActivated = wwebjsEnvironment.isRuntimeActivated;
  const runtimeStandby = wwebjsEnvironment.isWarmStandby;
  const runtimeState = runtimeStandby
    ? 'warm_standby'
    : runtimeActivated
      ? qrStreamReady
        ? 'active'
        : 'activating'
      : 'inactive';
  const nativeEvidence = connectionService.getConnectionStatusHealthEvidence();
  const nativeConnectionOnline = isWhatsappConnectionOnline(
    nativeEvidence.connectionStatus
  );
  const nativeProofReady =
    nativeConnectionOnline &&
    nativeEvidence.sourceCurrent &&
    Boolean(nativeEvidence.connectionStatusSourceId) &&
    nativeEvidence.leaseProofValid;
  const sessionReady = readiness.session_ready === true;
  const centralOnlineAcknowledged =
    connectionService.hasCentralOnlineAcknowledgement();
  const kafkaConsumersAuthorized = isWorkerKafkaDispatchAuthorized();
  const runtimeGenerationReady =
    Number.isSafeInteger(readiness.runtime_generation) &&
    Number(readiness.runtime_generation) > 0;
  const kafkaConsumers = getKafkaConsumerHealthSnapshots();
  const kafkaConsumerSummary = getKafkaConsumerHealthSummary(kafkaConsumers);
  const kafkaConsumersReady = areKafkaConsumersReady(kafkaConsumerSummary);
  const dispatchReady =
    kafkaConsumersReady &&
    kafkaConsumersAuthorized &&
    centralOnlineAcknowledged;
  const connectionReady =
    sessionReady && dispatchReady && runtimeGenerationReady && nativeProofReady;
  const degradedReason = !nativeConnectionOnline
    ? 'native_connection_not_online'
    : !nativeEvidence.sourceCurrent || !nativeEvidence.connectionStatusSourceId
      ? 'native_connection_status_source_invalid'
      : nativeEvidence.leaseRequired && !nativeEvidence.leaseProofValid
        ? 'session_lease_proof_unavailable'
        : sessionReady && kafkaConsumersReady && !dispatchReady
          ? 'awaiting_dispatch_authorization'
          : readiness.degraded_reason;
  const data = {
    ...readiness,
    session_ready: sessionReady && dispatchReady && nativeProofReady,
    can_send: readiness.can_send === true && dispatchReady && nativeProofReady,
    can_receive_runtime:
      readiness.can_receive_runtime === true &&
      dispatchReady &&
      nativeProofReady,
    degraded_reason: degradedReason,
    connected: connectionReady,
    ready: connectionReady,
    has_session: hasSession,
    qr_stream_ready: qrStreamReady,
    worker_id: runtimeActivated ? wwebjsEnvironment.wwebjsWorkerId : '',
    account_id: runtimeActivated ? wwebjsEnvironment.wwebjsAccountId : '',
    worker_type_id: wwebjsEnvironment.workerTypeId ?? EWorkerType.wwebjs,
    runtime_state: runtimeState,
    activated: runtimeActivated,
    standby: runtimeStandby,
    central_online_acknowledged: centralOnlineAcknowledged,
    runtime_generation_ready: runtimeGenerationReady,
    kafka_unhealthy: !kafkaConsumersReady,
    kafka_consumers_ready: kafkaConsumersReady,
    kafka_consumers_authorized: kafkaConsumersAuthorized,
    command_ingress_ready: kafkaConsumersReady,
    command_ingress_authorized: kafkaConsumersAuthorized,
    runtime_health_schema_version: 3,
    session_storage: nativeEvidence.sessionStorage,
    native_connection_online: nativeConnectionOnline,
    connection_status: nativeEvidence.connectionStatus,
    connection_status_source_id: nativeEvidence.connectionStatusSourceId,
    connection_status_source_current: nativeEvidence.sourceCurrent,
    connection_status_lease_required: nativeEvidence.leaseRequired,
    connection_status_lease_proof_valid: nativeEvidence.leaseProofValid,
    kafka_consumers: kafkaConsumers,
    kafka_consumer_summary: kafkaConsumerSummary,
  };

  if (connectionReady) {
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
