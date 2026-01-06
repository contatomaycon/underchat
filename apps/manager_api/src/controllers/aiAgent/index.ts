import { injectable } from 'tsyringe';
import { listAiAgent } from './methods/listAiAgent';
import { viewAiAgent } from './methods/viewAiAgent';
import { deleteAiAgent } from './methods/deleteAiAgent';
import { updateAiAgent } from './methods/updateAiAgent';
import { createAiAgent } from './methods/createAiAgent';
import { listAiAgentType } from './methods/listAiAgentType';

@injectable()
class AiAgentController {
  public listAiAgent = listAiAgent;
  public viewAiAgent = viewAiAgent;
  public deleteAiAgent = deleteAiAgent;
  public updateAiAgent = updateAiAgent;
  public createAiAgent = createAiAgent;
  public listAiAgentType = listAiAgentType;
}

export default AiAgentController;
