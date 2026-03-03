import { Keyboard } from 'react-native';

export function dismissKeyboard(): void {
  Keyboard.dismiss();
}

export function dismissKeyboardAnd<TArgs extends unknown[]>(
  handler?: (...args: TArgs) => unknown
): (...args: TArgs) => void {
  return (...args: TArgs) => {
    Keyboard.dismiss();
    handler?.(...args);
  };
}
