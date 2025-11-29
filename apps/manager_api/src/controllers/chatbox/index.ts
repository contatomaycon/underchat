import { injectable } from 'tsyringe';
import { listUsers } from './methods/listUsers';
import { listSectors } from './methods/listSectors';
import { listSectorUsers } from './methods/listSectorUsers';

@injectable()
class ChatboxController {
  public listUsers = listUsers;
  public listSectors = listSectors;
  public listSectorUsers = listSectorUsers;
}

export default ChatboxController;
