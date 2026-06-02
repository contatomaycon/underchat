import {
  Keyboard,
  Platform,
  type KeyboardAvoidingViewProps,
} from 'react-native';

export const keyboardAvoidingBehavior: KeyboardAvoidingViewProps['behavior'] =
  Platform.OS === 'ios' ? 'padding' : 'height';

export const modalKeyboardAvoidingBehavior: KeyboardAvoidingViewProps['behavior'] =
  'padding';

// Compensates bottom navigation/composer height so Android modal sheets sit on the keyboard.
export const ANDROID_MODAL_KEYBOARD_VERTICAL_OFFSET = -56;

export function getKeyboardVerticalOffset(iosOffset: number): number {
  return Platform.OS === 'ios' ? iosOffset : 0;
}

export function getModalKeyboardVerticalOffset(
  iosOffset: number,
  androidOffset = 0
): number {
  return Platform.OS === 'ios' ? iosOffset : androidOffset;
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
