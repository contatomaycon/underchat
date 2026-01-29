import { IWorkerPayload } from '@core/common/interfaces/IWorkerPayload';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';

export interface WorkerPayloadProto {
  action?: string;
  worker_id?: string;
  server_id?: string;
  account_id?: string;
  worker_status_id?: string;
  worker_type_id?: string;
  name?: string;
  previous_worker_status_id?: string;
}

export function protoToWorkerPayload(
  proto: WorkerPayloadProto
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

  return payload;
}

export function workerPayloadToProto(
  payload: IWorkerPayload
): WorkerPayloadProto {
  const proto: WorkerPayloadProto = {
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
  return proto;
}
