import { injectable } from 'tsyringe';
import { listSector } from './methods/listSector';
import { viewSector } from './methods/viewSector';
import { deleteSector } from './methods/deleteSector';
import { editSector } from './methods/editSector';
import { createSector } from './methods/createSector';
import { listSectorUsers } from './methods/listSectorUsers';

@injectable()
class SectorController {
  public listSector = listSector;
  public viewSector = viewSector;
  public deleteSector = deleteSector;
  public editSector = editSector;
  public createSector = createSector;
  public listSectorUsers = listSectorUsers;
}

export default SectorController;
