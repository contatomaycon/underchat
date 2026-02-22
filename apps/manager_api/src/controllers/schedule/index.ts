import { injectable } from 'tsyringe';
import { listSchedule } from './methods/listSchedule';
import { viewSchedule } from './methods/viewSchedule';
import { deleteSchedule } from './methods/deleteSchedule';
import { editSchedule } from './methods/editSchedule';
import { createSchedule } from './methods/createSchedule';
import { listScheduleWorkers } from './methods/listScheduleWorkers';
import { listScheduleContacts } from './methods/listScheduleContacts';
import { listScheduleContactGroups } from './methods/listScheduleContactGroups';
import { listScheduleMessages } from './methods/listScheduleMessages';
import { listScheduleChatbots } from './methods/listScheduleChatbots';
import { updateScheduleAction } from './methods/updateScheduleAction';

@injectable()
class ScheduleController {
  public listSchedule = listSchedule;
  public viewSchedule = viewSchedule;
  public deleteSchedule = deleteSchedule;
  public updateSchedule = editSchedule;
  public createSchedule = createSchedule;
  public listScheduleWorkers = listScheduleWorkers;
  public listScheduleChatbots = listScheduleChatbots;
  public listScheduleContacts = listScheduleContacts;
  public listScheduleContactGroups = listScheduleContactGroups;
  public listScheduleMessages = listScheduleMessages;
  public updateScheduleAction = updateScheduleAction;
}

export default ScheduleController;
