import { injectable } from 'tsyringe';
import { createWorker } from './methods/createWorker';

@injectable()
class WorkerController {
  public createWorker = createWorker;
}

export default WorkerController;
