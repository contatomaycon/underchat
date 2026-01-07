import { injectable } from 'tsyringe';
import { registerSubscription } from './methods/registerSubscription';
import { getPublicKey } from './methods/getPublicKey';
import { deleteSubscription } from './methods/deleteSubscription';

@injectable()
class PushController {
  public registerSubscription = registerSubscription;
  public getPublicKey = getPublicKey;
  public deleteSubscription = deleteSubscription;
}

export default PushController;
