import { injectable } from 'tsyringe';
import { getZipcode } from './methods/getZipcode';

@injectable()
class ZipcodeController {
  public viewZipcode = getZipcode;
}

export default ZipcodeController;
