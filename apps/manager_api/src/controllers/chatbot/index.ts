import { injectable } from 'tsyringe';
import { createChatbot } from './methods/createChatbot';
import { listChatbot } from './methods/listChatbot';
import { updateChatbot } from './methods/updateChatbot';
import { deleteChatbot } from './methods/deleteChatbot';
import { listUsers } from './methods/listUsers';
import { listSectors } from './methods/listSectors';
import { listSectorUsers } from './methods/listSectorUsers';
import { listChatTags } from './methods/listChatTags';
import { listAiAgents } from './methods/listAiAgents';
import { saveChatbotFlow } from './methods/saveChatbotFlow';
import { listChatbotFlow } from './methods/listChatbotFlow';
import { saveChatbotFlowConfigurations } from './methods/saveChatbotFlowConfigurations';
import { listChatbotFlowConfigurations } from './methods/listChatbotFlowConfigurations';
import { viewChatbotConfig } from './methods/viewChatbotConfig';

@injectable()
class ChatbotController {
  public createChatbot = createChatbot;
  public listChatbot = listChatbot;
  public updateChatbot = updateChatbot;
  public deleteChatbot = deleteChatbot;
  public listUsers = listUsers;
  public listSectors = listSectors;
  public listSectorUsers = listSectorUsers;
  public listChatTags = listChatTags;
  public listAiAgents = listAiAgents;
  public saveChatbotFlow = saveChatbotFlow;
  public listChatbotFlow = listChatbotFlow;
  public saveChatbotFlowConfigurations = saveChatbotFlowConfigurations;
  public listChatbotFlowConfigurations = listChatbotFlowConfigurations;
  public viewChatbotConfig = viewChatbotConfig;
}

export default ChatbotController;
