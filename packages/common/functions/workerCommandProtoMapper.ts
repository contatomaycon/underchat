import { IWorkerPayload } from '@core/common/interfaces/IWorkerPayload';
import { IWorkerPayloadProto } from '@core/common/interfaces/IWorkerPayloadProto';
import { IChangeConnectionStatusRequestProto } from '@core/common/interfaces/IChangeConnectionStatusRequestProto';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import { StatusConnectionWorkerRequest } from '@core/schema/worker/statusConnection/request.schema';

export function protoToWorkerPayload(
  proto: IWorkerPayloadProto
): IWorkerPayload {
  const action = proto.action as EWorkerAction;
  if (!action || !proto.worker_id || !proto.server_id || !proto.account_id) {
    throw new Error(
      'Missing required fields: action, worker_id, server_id, account_id'
    );
  }

  const payload: IWorkerPayload = {
    action,
    worker_id: proto.worker_id,
    server_id: proto.server_id,
    account_id: proto.account_id,
  };

  if (proto.previous_server_id) {
    payload.previous_server_id = proto.previous_server_id;
  }
  if (proto.worker_status_id) {
    payload.worker_status_id = proto.worker_status_id as EWorkerStatus;
  }
  if (proto.worker_type_id) {
    payload.worker_type_id = proto.worker_type_id as EWorkerType;
  }
  if (proto.name) {
    payload.name = proto.name;
  }
  if (proto.previous_worker_type_id) {
    payload.previous_worker_type_id =
      proto.previous_worker_type_id as EWorkerType;
  }
  if (proto.previous_worker_status_id) {
    payload.previous_worker_status_id =
      proto.previous_worker_status_id as EWorkerStatus;
  }
  if (
    proto.remove_session === true ||
    proto._remove_session === 'remove_session'
  ) {
    payload.remove_session = proto.remove_session === true;
  }
  if (
    proto.remove_volume === true ||
    proto._remove_volume === 'remove_volume'
  ) {
    payload.remove_volume = proto.remove_volume === true;
  }
  if (proto.lifecycle_operation_id) {
    payload.lifecycle_operation_id = proto.lifecycle_operation_id;
  }
  if (proto.recovery_without_journal === true) {
    payload.recovery_without_journal = true;
  }
  if (proto.lifecycle_semantic_fingerprint) {
    payload.lifecycle_semantic_fingerprint =
      proto.lifecycle_semantic_fingerprint;
  }
  if (proto.session_storage) {
    if (
      !Object.values(EWorkerSessionStorage).includes(
        proto.session_storage as EWorkerSessionStorage
      )
    ) {
      throw new Error('Invalid session_storage');
    }
    payload.session_storage = proto.session_storage as EWorkerSessionStorage;
  }
  if (proto.previous_session_storage) {
    if (
      !Object.values(EWorkerSessionStorage).includes(
        proto.previous_session_storage as EWorkerSessionStorage
      )
    ) {
      throw new Error('Invalid previous_session_storage');
    }
    payload.previous_session_storage =
      proto.previous_session_storage as EWorkerSessionStorage;
  }
  if (proto.session_storage_migration_id) {
    payload.session_storage_migration_id = proto.session_storage_migration_id;
  }
  if (proto.legacy_session_volume_name) {
    payload.legacy_session_volume_name = proto.legacy_session_volume_name;
  }
  if (proto.legacy_session_checksum) {
    payload.legacy_session_checksum = proto.legacy_session_checksum;
  }
  if (proto.debug_trace_id) {
    payload.debug_trace_id = proto.debug_trace_id;
  }
  if (proto.expected_container_id) {
    payload.expected_container_id = proto.expected_container_id;
    payload.expected_container_started_at = proto.expected_container_started_at;
    payload.expected_container_restart_count =
      proto.expected_container_restart_count;
    payload.expected_container_health_status =
      proto.expected_container_health_status;
    payload.expected_container_paused =
      proto.expected_container_paused === true;
    payload.expected_runtime_generation = proto.expected_runtime_generation;
  }

  return payload;
}

export function workerPayloadToProto(
  payload: IWorkerPayload
): IWorkerPayloadProto {
  const proto: IWorkerPayloadProto = {
    action: payload.action,
    worker_id: payload.worker_id,
    server_id: payload.server_id,
    account_id: payload.account_id,
  };
  if (payload.previous_server_id) {
    proto.previous_server_id = payload.previous_server_id;
  }
  if (payload.worker_status_id) {
    proto.worker_status_id = payload.worker_status_id;
  }
  if (payload.worker_type_id) {
    proto.worker_type_id = payload.worker_type_id;
  }
  if (payload.name) {
    proto.name = payload.name;
  }
  if (payload.previous_worker_type_id) {
    proto.previous_worker_type_id = payload.previous_worker_type_id;
  }
  if (payload.previous_worker_status_id) {
    proto.previous_worker_status_id = payload.previous_worker_status_id;
  }
  if (payload.remove_session !== undefined) {
    proto.remove_session = payload.remove_session;
    proto._remove_session = 'remove_session';
  }
  if (payload.remove_volume !== undefined) {
    proto.remove_volume = payload.remove_volume;
    proto._remove_volume = 'remove_volume';
  }
  if (payload.lifecycle_operation_id) {
    proto.lifecycle_operation_id = payload.lifecycle_operation_id;
  }
  if (payload.recovery_without_journal === true) {
    proto.recovery_without_journal = true;
  }
  if (payload.lifecycle_semantic_fingerprint) {
    proto.lifecycle_semantic_fingerprint =
      payload.lifecycle_semantic_fingerprint;
  }
  if (payload.session_storage) {
    proto.session_storage = payload.session_storage;
  }
  if (payload.previous_session_storage) {
    proto.previous_session_storage = payload.previous_session_storage;
  }
  if (payload.session_storage_migration_id) {
    proto.session_storage_migration_id = payload.session_storage_migration_id;
  }
  if (payload.legacy_session_volume_name) {
    proto.legacy_session_volume_name = payload.legacy_session_volume_name;
  }
  if (payload.legacy_session_checksum) {
    proto.legacy_session_checksum = payload.legacy_session_checksum;
  }
  if (payload.debug_trace_id) {
    proto.debug_trace_id = payload.debug_trace_id;
  }
  if (payload.expected_container_id) {
    proto.expected_container_id = payload.expected_container_id;
    proto.expected_container_started_at = payload.expected_container_started_at;
    proto.expected_container_restart_count =
      payload.expected_container_restart_count;
    proto.expected_container_health_status =
      payload.expected_container_health_status;
    proto.expected_container_paused =
      payload.expected_container_paused === true;
    proto.expected_runtime_generation = payload.expected_runtime_generation;
  }
  return proto;
}

export function protoToStatusConnectionRequest(
  proto: IChangeConnectionStatusRequestProto
): StatusConnectionWorkerRequest {
  if (!proto.worker_id || !proto.status || !proto.type) {
    throw new Error('Missing required fields: worker_id, status, type');
  }

  const payload: StatusConnectionWorkerRequest = {
    worker_id: proto.worker_id,
    status: proto.status as StatusConnectionWorkerRequest['status'],
    type: proto.type as StatusConnectionWorkerRequest['type'],
  };

  if (proto.phone_connection !== undefined && proto.phone_connection !== '') {
    payload.phone_connection = proto.phone_connection;
  }
  if (proto.remove_session === true) {
    payload.remove_session = true;
  }
  if (proto.connection_attempt_id) {
    payload.connection_attempt_id = proto.connection_attempt_id;
  }
  if (proto.authorized_connection_epoch) {
    payload.authorized_connection_epoch = proto.authorized_connection_epoch;
  }
  if (proto.debug_trace_id) {
    payload.debug_trace_id = proto.debug_trace_id;
  }
  if (proto.runtime_generation) {
    payload.runtime_generation = Number(proto.runtime_generation);
  }
  if (proto.warm_pool_id) {
    payload.warm_pool_id = proto.warm_pool_id;
  }
  if (proto.qr_pending === true) {
    payload.qr_pending = true;
  }
  if (proto.proxy_status) {
    payload.proxy_status =
      proto.proxy_status as StatusConnectionWorkerRequest['proxy_status'];
  }
  if (proto.proxy_error_code) {
    payload.proxy_error_code = proto.proxy_error_code;
  }
  if (proto.proxy_fallback) {
    payload.proxy_fallback =
      proto.proxy_fallback as StatusConnectionWorkerRequest['proxy_fallback'];
  }
  if (proto.proxy_bypassed === true) {
    payload.proxy_bypassed = true;
  }

  return payload;
}

export function statusConnectionRequestToProto(
  payload: StatusConnectionWorkerRequest,
  accountId?: string
): IChangeConnectionStatusRequestProto {
  const proto: IChangeConnectionStatusRequestProto = {
    worker_id: payload.worker_id,
    status: payload.status,
    type: payload.type,
  };
  if (payload.phone_connection) {
    proto.phone_connection = payload.phone_connection;
  }
  if (payload.remove_session === true) {
    proto.remove_session = true;
  }
  if (payload.connection_attempt_id) {
    proto.connection_attempt_id = payload.connection_attempt_id;
  }
  if (payload.authorized_connection_epoch) {
    proto.authorized_connection_epoch = payload.authorized_connection_epoch;
  }
  if (payload.debug_trace_id) {
    proto.debug_trace_id = payload.debug_trace_id;
  }
  if (payload.runtime_generation) {
    proto.runtime_generation = payload.runtime_generation;
  }
  if (payload.warm_pool_id) {
    proto.warm_pool_id = payload.warm_pool_id;
  }
  if (payload.qr_pending === true) {
    proto.qr_pending = true;
  }
  if (payload.proxy_status) {
    proto.proxy_status = payload.proxy_status;
  }
  if (payload.proxy_error_code) {
    proto.proxy_error_code = payload.proxy_error_code;
  }
  if (payload.proxy_fallback) {
    proto.proxy_fallback = payload.proxy_fallback;
  }
  if (payload.proxy_bypassed === true) {
    proto.proxy_bypassed = true;
  }
  if (accountId) {
    proto.account_id = accountId;
  }
  return proto;
}
