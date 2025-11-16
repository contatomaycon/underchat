import { ICreateMessageParams } from './ICreateMessageParams';

export interface ICreateContactMessageParams extends ICreateMessageParams {
  hash: string | null;
}
