import { injectable } from 'tsyringe';
import { listSector } from './methods/listSector';
import { viewSector } from './methods/viewSector';
import { deleteSector } from './methods/deleteSector';
import { editSector } from './methods/editSector';
import { createSector } from './methods/createSector';
import { listSectorRoleAccount } from './methods/listSectorRoleAccount';
import { listSectorRoleAccountSector } from './methods/listSectorRoleAccountSector';
import { createSectorRole } from './methods/createSectorRole';

@injectable()
class SectorController {
  public listSector = listSector;
  public viewSector = viewSector;
  public deleteSector = deleteSector;
  public editSector = editSector;
  public createSector = createSector;
  public listSectorRoleAccount = listSectorRoleAccount;
  public listSectorRoleAccountSector = listSectorRoleAccountSector;
  public createSectorRole = createSectorRole;
}

export default SectorController;
