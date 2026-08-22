import { EColor } from '@core/common/enums/EColor';
import { EWorkerRecreatePhase } from '@core/common/enums/EWorkerRecreatePhase';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import {
  projectWhatsappChannelDisplayStatus,
  type WhatsappChannelDisplayStatus,
  type WhatsappConnectionPublicStatus,
} from '@core/common/functions/whatsappConnectionStatus';

export interface ChannelStatusPresentationInput {
  workerTypeId?: string | null;
  workerStatusId?: string | null;
  /** Persisted phone identity proving that this recreate can restore a session. */
  sessionIdentityPresent?: boolean | null;
  connectionStatus?: WhatsappConnectionPublicStatus | null;
  connectionOnlineAcknowledged?: boolean | null;
  recreatePhase?: EWorkerRecreatePhase | null;
}

export interface ChannelStatusPresentation {
  key: string;
  color: EColor;
  text: string;
  display: WhatsappChannelDisplayStatus;
  online: boolean;
}

type Translate = (key: string) => string;

const resolveDisplay = (
  input: ChannelStatusPresentationInput
): WhatsappChannelDisplayStatus => projectWhatsappChannelDisplayStatus(input);

export const resolveChannelStatusPresentation = (
  input: ChannelStatusPresentationInput,
  t: Translate
): ChannelStatusPresentation => {
  const display = resolveDisplay(input);

  // `recreating` remains the durable worker status while the manager replaces
  // the container. Once that exact lifecycle operation has bootstrapped its
  // new runtime, `recreatePhase=connecting` is the fenced, durable subphase
  // that tells the UI the restored session is being connected. A persisted
  // session identity is required because sessionless runtimes cross the same
  // bootstrap phase before returning to QR readiness. This is not a
  // provider-native override of worker.worker_status_id.
  if (
    input.workerStatusId === EWorkerStatus.recreating &&
    input.recreatePhase === EWorkerRecreatePhase.connecting &&
    input.sessionIdentityPresent === true
  ) {
    return {
      key: `${EWorkerStatus.recreating}:${EWorkerRecreatePhase.connecting}`,
      color: EColor.info,
      text: t('connecting'),
      display,
      online: false,
    };
  }

  if (display.kind === 'connection') {
    switch (display.connectionStatus) {
      case 'online':
        return {
          key: 'whatsapp_connection_online',
          color: EColor.success,
          text: t('channel_connected'),
          display,
          online: true,
        };
      case 'qr':
        return {
          key: 'whatsapp_connection_qr',
          color: EColor.warning,
          text: t('awaiting_qr_code'),
          display,
          online: false,
        };
      case 'connecting':
        return {
          key: 'whatsapp_connection_connecting',
          color: EColor.info,
          text: t('connecting'),
          display,
          online: false,
        };
      case 'reconnect_required':
        return {
          key: 'whatsapp_connection_reconnect_required',
          color: EColor.error,
          text: t('whatsapp_reconnect_required'),
          display,
          online: false,
        };
      case 'error':
        return {
          key: 'whatsapp_connection_error',
          color: EColor.error,
          text: t('error'),
          display,
          online: false,
        };
      case 'offline':
        return {
          key: 'whatsapp_connection_offline',
          color: EColor.error,
          text: t('offline'),
          display,
          online: false,
        };
    }
  }

  const workerStatusId = display.workerStatusId;
  if (workerStatusId === EWorkerStatus.disponible) {
    return {
      key: workerStatusId,
      color: EColor.warning,
      text: t('awaiting_qr_code'),
      display,
      online: false,
    };
  }
  if (workerStatusId === EWorkerStatus.offline) {
    return {
      key: workerStatusId,
      color: EColor.error,
      text: t('offline'),
      display,
      online: false,
    };
  }
  if (workerStatusId === EWorkerStatus.online) {
    return {
      key: workerStatusId,
      color: EColor.success,
      text: t('channel_connected'),
      display,
      online: true,
    };
  }
  if (workerStatusId === EWorkerStatus.connecting) {
    return {
      key: workerStatusId,
      color: EColor.info,
      text: t('connecting'),
      display,
      online: false,
    };
  }
  if (workerStatusId === EWorkerStatus.new) {
    return {
      key: workerStatusId,
      color: EColor.info,
      text: t('new'),
      display,
      online: false,
    };
  }
  if (workerStatusId === EWorkerStatus.creating) {
    return {
      key: workerStatusId,
      color: EColor.warning,
      text: t('creating'),
      display,
      online: false,
    };
  }
  if (workerStatusId === EWorkerStatus.deleting) {
    return {
      key: workerStatusId,
      color: EColor.error,
      text: t('deleting'),
      display,
      online: false,
    };
  }
  if (workerStatusId === EWorkerStatus.delete) {
    return {
      key: workerStatusId,
      color: EColor.info,
      text: t('deletion_pending'),
      display,
      online: false,
    };
  }
  if (workerStatusId === EWorkerStatus.recreating) {
    return {
      key: workerStatusId,
      color: EColor.warning,
      text: t('recreating'),
      display,
      online: false,
    };
  }
  if (workerStatusId === EWorkerStatus.error) {
    return {
      key: workerStatusId,
      color: EColor.error,
      text: t('error'),
      display,
      online: false,
    };
  }
  if (workerStatusId === EWorkerStatus.mismatched) {
    return {
      key: workerStatusId,
      color: EColor.error,
      text: t('mismatched'),
      display,
      online: false,
    };
  }
  if (workerStatusId === EWorkerStatus.stopped) {
    return {
      key: workerStatusId,
      color: EColor.warning,
      text: t('stopped'),
      display,
      online: false,
    };
  }
  if (workerStatusId === EWorkerStatus.blocked) {
    return {
      key: workerStatusId,
      color: EColor.secondary,
      text: t('blocked_by_plan'),
      display,
      online: false,
    };
  }

  return {
    key: workerStatusId ?? 'unknown',
    color: EColor.primary,
    text: t('unknown'),
    display,
    online: false,
  };
};
