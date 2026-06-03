import { IWorkerPayload } from '@core/common/interfaces/IWorkerPayload';
import { IWorkerPayloadProto } from '@core/common/interfaces/IWorkerPayloadProto';
import { IChangeConnectionStatusRequestProto } from '@core/common/interfaces/IChangeConnectionStatusRequestProto';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
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

  if (proto.worker_status_id) {
    payload.worker_status_id = proto.worker_status_id as EWorkerStatus;
  }
  if (proto.worker_type_id) {
    payload.worker_type_id = proto.worker_type_id as EWorkerType;
  }
  if (proto.name) {
    payload.name = proto.name;
  }
  if (proto.previous_worker_status_id) {
    payload.previous_worker_status_id =
      proto.previous_worker_status_id as EWorkerStatus;
  }
  if (proto.remove_session === true) {
    payload.remove_session = true;
  }
  if (proto.remove_volume === true) {
    payload.remove_volume = true;
  }
  if (proto.lifecycle_operation_id) {
    payload.lifecycle_operation_id = proto.lifecycle_operation_id;
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
  if (payload.worker_status_id) {
    proto.worker_status_id = payload.worker_status_id;
  }
  if (payload.worker_type_id) {
    proto.worker_type_id = payload.worker_type_id;
  }
  if (payload.name) {
    proto.name = payload.name;
  }
  if (payload.previous_worker_status_id) {
    proto.previous_worker_status_id = payload.previous_worker_status_id;
  }
  if (payload.remove_session === true) {
    proto.remove_session = true;
  }
  if (payload.remove_volume === true) {
    proto.remove_volume = true;
  }
  if (payload.lifecycle_operation_id) {
    proto.lifecycle_operation_id = payload.lifecycle_operation_id;
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
  if (proto.qr_pending === true) {
    payload.qr_pending = true;
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
  if (payload.qr_pending === true) {
    proto.qr_pending = true;
  }
  if (accountId) {
    proto.account_id = accountId;
  }
  return proto;
}
