import { injectable } from 'tsyringe';
import { setOnline } from './methods/setOnline';
import { heartbeat } from './methods/heartbeat';
import { setOffline } from './methods/setOffline';
import { setAway } from './methods/setAway';

@injectable()
class PresenceController {
  public setOnline = setOnline;
  public heartbeat = heartbeat;
  public setOffline = setOffline;
  public setAway = setAway;
}

export default PresenceController;
