import { injectable } from 'tsyringe';
import { listExpenditure } from './methods/listExpenditure';
import { createExpenditure } from './methods/createExpenditure';
import { updateExpenditure } from './methods/updateExpenditure';
import { deleteExpenditure } from './methods/deleteExpenditure';

@injectable()
class ExpenditureController {
  public listExpenditure = listExpenditure;
  public createExpenditure = createExpenditure;
  public updateExpenditure = updateExpenditure;
  public deleteExpenditure = deleteExpenditure;
}

export default ExpenditureController;
