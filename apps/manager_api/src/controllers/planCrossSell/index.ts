import { injectable } from 'tsyringe';
import { listCrossSell } from './methods/listCrossSell';
import { createCrossSell } from './methods/createCrossSell';
import { updateCrossSell } from './methods/updateCrossSell';
import { deleteCrossSell } from './methods/deleteCrossSell';
import { createCrossSellAccount } from './methods/createCrossSellAccount';
import { listCrossSellAccount } from './methods/listCrossSellAccount';
import { deleteCrossSellAccount } from './methods/deleteCrossSellAccount';

@injectable()
class PlanCrossSellController {
  public listCrossSell = listCrossSell;
  public createCrossSell = createCrossSell;
  public updateCrossSell = updateCrossSell;
  public deleteCrossSell = deleteCrossSell;
  public createCrossSellAccount = createCrossSellAccount;
  public listCrossSellAccount = listCrossSellAccount;
  public deleteCrossSellAccount = deleteCrossSellAccount;
}

export default PlanCrossSellController;
