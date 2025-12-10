import { injectable } from 'tsyringe';
import { listExpenditure } from './methods/listExpenditure';
import { viewExpenditure } from './methods/viewExpenditure';
import { deleteExpenditure } from './methods/deleteExpenditure';
import { editExpenditure } from './methods/editExpenditure';
import { createExpenditure } from './methods/createExpenditure';

@injectable()
class ExpenditureController {
  public listExpenditure = listExpenditure;
  public viewExpenditure = viewExpenditure;
  public deleteExpenditure = deleteExpenditure;
  public updateExpenditure = editExpenditure;
  public createExpenditure = createExpenditure;
}

export default ExpenditureController;
