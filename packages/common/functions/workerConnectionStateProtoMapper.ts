import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { IWorkerConnectionStateProto } from '@core/common/interfaces/IWorkerConnectionStateProto';

function optionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value !== 0) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed !== 0 ? parsed : undefined;
  }

  return undefined;
}

export function protoToConnectionState(
  proto: IWorkerConnectionStateProto
): IBaileysConnectionState {
  const state: IBaileysConnectionState = {
    code: (proto.code || ECodeMessage.awaitConnection) as ECodeMessage,
    status:
      (proto.status as EBaileysConnectionStatus) ??
      EBaileysConnectionStatus.connecting,
    worker_id: proto.worker_id ?? '',
    account_id: proto.account_id ?? '',
  };

  if (proto.qrcode) state.qrcode = proto.qrcode;
  if (proto.is_new_login) state.is_new_login = proto.is_new_login;
  if (proto.phone) state.phone = proto.phone;
  if (proto.disconnected_user) {
    state.disconnected_user = proto.disconnected_user;
  }
  if (proto.pairing_code) state.pairing_code = proto.pairing_code;
  if (proto.worker_status_id) {
    state.worker_status_id = proto.worker_status_id as EWorkerStatus;
  }

  const time = optionalNumber(proto.time);
  const secondsUntilNextAttempt = optionalNumber(
    proto.seconds_until_next_attempt
  );
  const attempt = optionalNumber(proto.attempt);
  const maxAttempts = optionalNumber(proto.max_attempts);

  if (time !== undefined) state.time = time;
  if (secondsUntilNextAttempt !== undefined) {
    state.seconds_until_next_attempt = secondsUntilNextAttempt;
  }
  if (attempt !== undefined) state.attempt = attempt;
  if (maxAttempts !== undefined) state.max_attempts = maxAttempts;

  return state;
}

export function connectionStateToProto(
  state: IBaileysConnectionState
): IWorkerConnectionStateProto {
  return {
    code: state.code,
    status: state.status,
    worker_id: state.worker_id,
    account_id: state.account_id,
    qrcode: state.qrcode ?? '',
    is_new_login: state.is_new_login ?? false,
    time: state.time ?? 0,
    phone: state.phone ?? '',
    disconnected_user: state.disconnected_user ?? false,
    pairing_code: state.pairing_code ?? '',
    seconds_until_next_attempt: state.seconds_until_next_attempt ?? 0,
    worker_status_id: state.worker_status_id ?? '',
    attempt: state.attempt ?? 0,
    max_attempts: state.max_attempts ?? 0,
  };
}
