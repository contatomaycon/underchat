import { injectable } from 'tsyringe';
import { createWorker } from './methods/createWorker';
import { deleteWorker } from './methods/deleteWorker';

@injectable()
class WorkerController {
  public createWorker = createWorker;
  public deleteWorker = deleteWorker;
}

export default WorkerController;
