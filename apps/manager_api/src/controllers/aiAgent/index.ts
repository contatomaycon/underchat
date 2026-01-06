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
}

export default AiAgentController;
