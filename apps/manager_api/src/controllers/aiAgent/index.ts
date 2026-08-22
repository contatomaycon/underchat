import { injectable } from 'tsyringe';
import { listAiAgent } from './methods/listAiAgent';
import { viewAiAgent } from './methods/viewAiAgent';
import { deleteAiAgent } from './methods/deleteAiAgent';
import { updateAiAgent } from './methods/updateAiAgent';
import { createAiAgent } from './methods/createAiAgent';
import { listAiAgentType } from './methods/listAiAgentType';
import { listAiAgentPrompt } from './methods/listAiAgentPrompt';
import { createAiAgentPrompt } from './methods/createAiAgentPrompt';
import { viewAiAgentPrompt } from './methods/viewAiAgentPrompt';
import { updateAiAgentPrompt } from './methods/updateAiAgentPrompt';
import { deleteAiAgentPrompt } from './methods/deleteAiAgentPrompt';
import { viewAiAgentConfig } from './methods/viewAiAgentConfig';
import { refreshAiAgentPrompt } from './methods/refreshAiAgentPrompt';
import { refreshAllAiAgentPrompts } from './methods/refreshAllAiAgentPrompts';
import { listAiAgentUsage } from './methods/listAiAgentUsage';
import { viewAiAgentHumanTransfer } from './methods/viewAiAgentHumanTransfer';
import { upsertAiAgentHumanTransfer } from './methods/upsertAiAgentHumanTransfer';
import { listAiAgentHumanTransferSectors } from './methods/listAiAgentHumanTransferSectors';
import { listAiAgentHumanTransferSectorUsers } from './methods/listAiAgentHumanTransferSectorUsers';
import { listAiAgentHumanTransferSectorUsersBySectorIds } from './methods/listAiAgentHumanTransferSectorUsersBySectorIds';
import { blockAiAgent } from './methods/blockAiAgent';
import { unblockAiAgent } from './methods/unblockAiAgent';

@injectable()
class AiAgentController {
  public listAiAgent = listAiAgent;
  public viewAiAgent = viewAiAgent;
  public deleteAiAgent = deleteAiAgent;
  public updateAiAgent = updateAiAgent;
  public createAiAgent = createAiAgent;
  public listAiAgentType = listAiAgentType;
  public listAiAgentPrompt = listAiAgentPrompt;
  public createAiAgentPrompt = createAiAgentPrompt;
  public viewAiAgentPrompt = viewAiAgentPrompt;
  public updateAiAgentPrompt = updateAiAgentPrompt;
  public deleteAiAgentPrompt = deleteAiAgentPrompt;
  public viewAiAgentConfig = viewAiAgentConfig;
  public refreshAiAgentPrompt = refreshAiAgentPrompt;
  public refreshAllAiAgentPrompts = refreshAllAiAgentPrompts;
  public listAiAgentUsage = listAiAgentUsage;
  public viewAiAgentHumanTransfer = viewAiAgentHumanTransfer;
  public upsertAiAgentHumanTransfer = upsertAiAgentHumanTransfer;
  public listAiAgentHumanTransferSectors = listAiAgentHumanTransferSectors;
  public listAiAgentHumanTransferSectorUsers =
    listAiAgentHumanTransferSectorUsers;
  public listAiAgentHumanTransferSectorUsersBySectorIds =
    listAiAgentHumanTransferSectorUsersBySectorIds;
  public blockAiAgent = blockAiAgent;
  public unblockAiAgent = unblockAiAgent;
}

export default AiAgentController;
