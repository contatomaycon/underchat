import { injectable } from 'tsyringe';
import { listSector } from './methods/listSector';
import { viewSector } from './methods/viewSector';
import { deleteSector } from './methods/deleteSector';
import { editSector } from './methods/editSector';
import { createSector } from './methods/createSector';

@injectable()
class SectorController {
  public listSector = listSector;
  public viewSector = viewSector;
  public deleteSector = deleteSector;
  public editSector = editSector;
  public createSector = createSector;
}

export default SectorController;
