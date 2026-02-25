import { injectable } from 'tsyringe';
import { listRandomMessage } from './methods/listRandomMessage';
import { createRandomMessage } from './methods/createRandomMessage';
import { viewRandomMessage } from './methods/viewRandomMessage';
import { updateRandomMessage } from './methods/updateRandomMessage';
import { deleteRandomMessage } from './methods/deleteRandomMessage';
import { listRandomMessageItem } from './methods/listRandomMessageItem';
import { createRandomMessageItem } from './methods/createRandomMessageItem';
import { viewRandomMessageItem } from './methods/viewRandomMessageItem';
import { updateRandomMessageItem } from './methods/updateRandomMessageItem';
import { deleteRandomMessageItem } from './methods/deleteRandomMessageItem';

@injectable()
class RandomMessageController {
  public listRandomMessage = listRandomMessage;
  public createRandomMessage = createRandomMessage;
  public viewRandomMessage = viewRandomMessage;
  public updateRandomMessage = updateRandomMessage;
  public deleteRandomMessage = deleteRandomMessage;
  public listRandomMessageItem = listRandomMessageItem;
  public createRandomMessageItem = createRandomMessageItem;
  public viewRandomMessageItem = viewRandomMessageItem;
  public updateRandomMessageItem = updateRandomMessageItem;
  public deleteRandomMessageItem = deleteRandomMessageItem;
}

export default RandomMessageController;
