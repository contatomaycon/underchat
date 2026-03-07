import { Keyboard, Platform } from 'react-native';

export const keyboardAvoidingBehavior =
  Platform.OS === 'ios' ? 'padding' : 'height';

export function getKeyboardVerticalOffset(iosOffset: number): number {
  return Platform.OS === 'ios' ? iosOffset : 0;
}

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
