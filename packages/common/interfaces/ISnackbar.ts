import { EColor } from '../enums/EColor';

export interface ISnackbar {
  color: EColor;
  message: string;
  status: boolean;
}
