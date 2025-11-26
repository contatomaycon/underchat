import { injectable } from 'tsyringe';
import { getZipcode } from './methods/getZipcode';
import { listStates } from './methods/listStates';
import { listCities } from './methods/listCities';

@injectable()
class ZipcodeController {
  public viewZipcode = getZipcode;
  public listStates = listStates;
  public listCities = listCities;
}

export default ZipcodeController;
