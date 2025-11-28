import { injectable } from 'tsyringe';
import { setOnline } from './methods/setOnline';
import { heartbeat } from './methods/heartbeat';
import { setOffline } from './methods/setOffline';
import { setAway } from './methods/setAway';
import { setBusy } from './methods/setBusy';
import { setDoNotDisturb } from './methods/setDoNotDisturb';

@injectable()
class PresenceController {
  public setOnline = setOnline;
  public heartbeat = heartbeat;
  public setOffline = setOffline;
  public setAway = setAway;
  public setBusy = setBusy;
  public setDoNotDisturb = setDoNotDisturb;
}

export default PresenceController;
