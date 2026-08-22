import type {
  ServerInstallEventType,
  ServerInstallStageId,
  ServerInstallStageStatus,
  ServerInstallStatus,
} from './IServerInstallEvent';

export interface IServerSshCentrifugo {
  server_id: string;
  command: string;
  output: string;
  date: string | Date;
  event_id?: string;
  installation_id?: string;
  install_event_type?: ServerInstallEventType;
  install_stage?: ServerInstallStageId;
  install_stage_status?: ServerInstallStageStatus;
  install_status?: ServerInstallStatus;
}
