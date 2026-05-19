import { injectable } from 'tsyringe';
import { createChatbot } from './methods/createChatbot';
import { listChatbot } from './methods/listChatbot';
import { updateChatbot } from './methods/updateChatbot';
import { deleteChatbot } from './methods/deleteChatbot';
import { listUsers } from './methods/listUsers';
import { listChannels } from './methods/listChannels';
import { listSectors } from './methods/listSectors';
import { listSectorUsers } from './methods/listSectorUsers';
import { listChatTags } from './methods/listChatTags';
import { listAiAgents } from './methods/listAiAgents';
import { listRandomMessages } from './methods/listRandomMessages';
import { saveChatbotFlow } from './methods/saveChatbotFlow';
import { listChatbotFlow } from './methods/listChatbotFlow';
import { saveChatbotFlowConfigurations } from './methods/saveChatbotFlowConfigurations';
import { listChatbotFlowConfigurations } from './methods/listChatbotFlowConfigurations';
import { viewChatbotConfig } from './methods/viewChatbotConfig';
import { cloneChatbot } from './methods/cloneChatbot';
import { listNationalHolidays } from './methods/listNationalHolidays';
import { listLocalHolidays } from './methods/listLocalHolidays';
import { createLocalHoliday } from './methods/createLocalHoliday';
import { updateLocalHoliday } from './methods/updateLocalHoliday';
import { deleteLocalHoliday } from './methods/deleteLocalHoliday';

@injectable()
class ChatbotController {
  public createChatbot = createChatbot;
  public listChatbot = listChatbot;
  public updateChatbot = updateChatbot;
  public deleteChatbot = deleteChatbot;
  public cloneChatbot = cloneChatbot;
  public listUsers = listUsers;
  public listChannels = listChannels;
  public listSectors = listSectors;
  public listSectorUsers = listSectorUsers;
  public listChatTags = listChatTags;
  public listAiAgents = listAiAgents;
  public listRandomMessages = listRandomMessages;
  public saveChatbotFlow = saveChatbotFlow;
  public listChatbotFlow = listChatbotFlow;
  public saveChatbotFlowConfigurations = saveChatbotFlowConfigurations;
  public listChatbotFlowConfigurations = listChatbotFlowConfigurations;
  public viewChatbotConfig = viewChatbotConfig;
  public listNationalHolidays = listNationalHolidays;
  public listLocalHolidays = listLocalHolidays;
  public createLocalHoliday = createLocalHoliday;
  public updateLocalHoliday = updateLocalHoliday;
  public deleteLocalHoliday = deleteLocalHoliday;
}

export default ChatbotController;
