import { injectable } from 'tsyringe';
import { createWorker } from './methods/createWorker';
import { deleteWorker } from './methods/deleteWorker';
import { recreateCreateWorker } from './methods/recreateCreateWorker';

@injectable()
class WorkerController {
  public createWorker = createWorker;
  public deleteWorker = deleteWorker;
  public recreateCreateWorker = recreateCreateWorker;
}

export default WorkerController;
