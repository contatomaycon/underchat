import { ActivityIndicator, Modal, StyleSheet, Text, View } from 'react-native';
import { pt } from '../locales/pt';
import { colors } from '../theme/colors';

type OpeningConversationModalProps = {
  visible: boolean;
  variant: 'chat' | 'internal';
};

export function OpeningConversationModal({
  visible,
  variant,
}: OpeningConversationModalProps) {
  const description =
    variant === 'internal'
      ? pt.opening_internal_conversation_messages
      : pt.opening_conversation_messages;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={() => {}}
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.title}>{pt.opening_conversation_title}</Text>
          <Text style={styles.text}>{description}</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  card: {
    width: '100%',
    maxWidth: 300,
    borderRadius: 14,
    paddingHorizontal: 22,
    paddingVertical: 24,
    alignItems: 'center',
    backgroundColor: colors.surface,
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  title: {
    marginTop: 14,
    color: colors.onSurface,
    fontSize: 16,
    fontWeight: '800',
  },
  text: {
    marginTop: 6,
    color: colors.grey600,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
});
