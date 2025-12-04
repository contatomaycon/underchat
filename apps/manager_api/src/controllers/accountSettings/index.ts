import { injectable } from 'tsyringe';
import { updatePhoto } from './methods/updatePhoto';
import { deletePhoto } from './methods/deletePhoto';
import { updateAdditionalInfo } from './methods/updateAdditionalInfo';
import { updateAddress } from './methods/updateAddress';
import { viewPhone } from './methods/viewPhone';
import { viewDocument } from './methods/viewDocument';
import { viewAddress } from './methods/viewAddress';
import { viewAddress1 } from './methods/viewAddress1';
import { viewAddress2 } from './methods/viewAddress2';
import { viewAdditionalInfo } from './methods/viewAdditionalInfo';

@injectable()
class AccountSettingsController {
  public updatePhoto = updatePhoto;
  public deletePhoto = deletePhoto;
  public updateAdditionalInfo = updateAdditionalInfo;
  public updateAddress = updateAddress;
  public viewPhone = viewPhone;
  public viewDocument = viewDocument;
  public viewAddress = viewAddress;
  public viewAddress1 = viewAddress1;
  public viewAddress2 = viewAddress2;
  public viewAdditionalInfo = viewAdditionalInfo;
}

export default AccountSettingsController;
