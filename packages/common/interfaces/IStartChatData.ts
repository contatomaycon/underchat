import { ViewContactResponse } from '@core/schema/contact/viewContact/response.schema';
import { IViewUserNamePhoto } from './IViewUserNamePhoto';
import { IViewAccountName } from './IViewAccountName';
import { IViewWorkerNameAndId } from './IViewWorkerNameAndId';

export interface IContactData {
  contact: ViewContactResponse;
  sensitiveData: { phone: string | null; email: string | null } | null;
  contactName: string;
  phonePartial: string;
  fullPhone: string;
  remoteJid?: string | null;
}

export interface IRequiredData {
  user: IViewUserNamePhoto;
  account: IViewAccountName;
  worker: IViewWorkerNameAndId;
  sector: { id: string; name: string; color?: string } | null;
}
