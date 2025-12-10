import { EChatUserStatus } from '../enums/EChatUserStatus';

export interface IPresenceMessage {
  event: 'presence_update';
  user_id: string;
  status: EChatUserStatus;
  is_heartbeat?: boolean;
}
