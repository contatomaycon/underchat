import { type ReactNode } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  KeyboardAvoidingView,
  ScrollView,
  StyleSheet,
  Platform,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import {
  keyboardAvoidingBehavior,
  getKeyboardVerticalOffset,
  dismissKeyboardAnd,
} from '../utils/keyboard';

export interface BottomSheetModalProps {
  /** Whether the modal is visible */
  visible: boolean;
  /** Called when the user requests to close (back button / backdrop tap) */
  onClose: () => void;
  /** Title displayed in the header */
  title: string;
  /** Main content — rendered inside a ScrollView so it never overflows */
  children: ReactNode;
  /**
   * Footer content (buttons) — rendered **outside** the scroll area
   * with `flexShrink: 0` so it is **never** clipped by the keyboard.
   */
  footer?: ReactNode;
  /** Additional style applied to the card container */
  cardStyle?: StyleProp<ViewStyle>;
  /** Additional style applied to the footer container */
  footerStyle?: StyleProp<ViewStyle>;
  /** Animation type for the modal — defaults to "slide" */
  animationType?: 'slide' | 'fade' | 'none';
  /**
   * When `true` the body is NOT wrapped in a ScrollView.
   * Useful when the caller already provides its own scrollable (FlatList, etc.).
   */
  noScroll?: boolean;
  /**
   * Extra content rendered **between** the KeyboardAvoidingView and the Modal
   * boundary – used by modals that embed a `<SelectSheet>` alongside.
   */
  extraContent?: ReactNode;
  /** Whether to use KeyboardAvoidingView – defaults to `true` */
  avoidKeyboard?: boolean;
  /**
   * Override the statusBarTranslucent on Android for specific modals.
   * Defaults to true.
   */
  statusBarTranslucent?: boolean;
  /** Pass through hardwareAccelerated to Modal */
  hardwareAccelerated?: boolean;
}

export function BottomSheetModal({
  visible,
  onClose,
  title,
  children,
  footer,
  cardStyle,
  footerStyle,
  animationType = 'slide',
  noScroll = false,
  extraContent,
  avoidKeyboard = true,
  statusBarTranslucent = true,
  hardwareAccelerated,
}: BottomSheetModalProps) {
  const insets = useSafeAreaInsets();

  const dismissAndClose = dismissKeyboardAnd(onClose);

  const card = (
    <View style={[styles.card, cardStyle]}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        <Pressable onPress={dismissAndClose} hitSlop={8}>
          <Ionicons name="close" size={22} color={colors.onSurface} />
        </Pressable>
      </View>

      {/* ── Body ── */}
      {noScroll ? (
        <View style={styles.body}>{children}</View>
      ) : (
        <ScrollView
          style={styles.body}
          contentContainerStyle={styles.bodyContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={
            Platform.OS === 'ios' ? 'interactive' : 'on-drag'
          }
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          {children}
        </ScrollView>
      )}

      {/* ── Footer (never scrollable, never clipped) ── */}
      {footer ? (
        <View style={[styles.footer, footerStyle]}>{footer}</View>
      ) : null}
    </View>
  );

  const overlayContent = (
    <>
      <Pressable style={styles.backdrop} onPress={dismissAndClose} />
      {card}
    </>
  );

  const inner = avoidKeyboard ? (
    <KeyboardAvoidingView
      style={styles.keyboardAvoiding}
      behavior={keyboardAvoidingBehavior}
      keyboardVerticalOffset={getKeyboardVerticalOffset(insets.bottom + 8)}
    >
      <View style={[styles.overlay, { paddingBottom: insets.bottom }]}>
        {overlayContent}
      </View>
      {extraContent}
    </KeyboardAvoidingView>
  ) : (
    <View style={[styles.overlay, { paddingBottom: insets.bottom }]}>
      {overlayContent}
    </View>
  );

  return (
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent={statusBarTranslucent}
      navigationBarTranslucent={statusBarTranslucent}
      hardwareAccelerated={hardwareAccelerated}
      animationType={animationType}
      onRequestClose={dismissAndClose}
    >
      {inner}
    </Modal>
  );
}

const styles = StyleSheet.create({
  keyboardAvoiding: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  card: {
    maxHeight: '82%',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 28 : 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 10,
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.onSurface,
  },
  body: {
    flexShrink: 1,
    minHeight: 0,
  },
  bodyContent: {
    flexGrow: 1,
    gap: 12,
  },
  footer: {
    flexShrink: 0,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.grey200,
  },
});
