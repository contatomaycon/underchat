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
import { changePassword } from './methods/changePassword';
import { viewCurrentPlanInvoice } from './methods/viewCurrentPlanInvoice';
import { listAccountPayments } from './methods/listAccountPayments';
import { listUserCards } from './methods/listUserCards';
import { deleteUserCard } from './methods/deleteUserCard';
import { updatePlanRecurring } from './methods/updatePlanRecurring';
import { listAccountAddons } from './methods/listAccountAddons';
import { listAccountPlanProducts } from './methods/listAccountPlanProducts';
import { updateUserCardDefault } from './methods/updateUserCardDefault';
import { createUserCard } from './methods/createUserCard';
import { viewAccountPaymentNfse } from './methods/viewAccountPaymentNfse';
import { cancelPlanAccount } from './methods/cancelPlanAccount';
import { reactivatePlanAccount } from './methods/reactivatePlanAccount';
import { viewAccountCustomization } from './methods/viewAccountCustomization';
import { createAccountCustomization } from './methods/createAccountCustomization';
import { updateAccountCustomization } from './methods/updateAccountCustomization';

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
  public changePassword = changePassword;
  public viewCurrentPlanInvoice = viewCurrentPlanInvoice;
  public listAccountPayments = listAccountPayments;
  public listUserCards = listUserCards;
  public deleteUserCard = deleteUserCard;
  public updatePlanRecurring = updatePlanRecurring;
  public listAccountAddons = listAccountAddons;
  public listAccountPlanProducts = listAccountPlanProducts;
  public updateUserCardDefault = updateUserCardDefault;
  public createUserCard = createUserCard;
  public viewAccountPaymentNfse = viewAccountPaymentNfse;
  public cancelPlanAccount = cancelPlanAccount;
  public reactivatePlanAccount = reactivatePlanAccount;
  public viewAccountCustomization = viewAccountCustomization;
  public createAccountCustomization = createAccountCustomization;
  public updateAccountCustomization = updateAccountCustomization;
}

export default AccountSettingsController;
