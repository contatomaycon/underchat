import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { pt } from '../locales/pt';
import { colors } from '../theme/colors';
import { requestIgnoreBatteryOptimizations } from '../utils/batteryOptimization';

type Props = {
  visible: boolean;
  onDismiss: () => void;
};

export function BatteryOptimizationModal({ visible, onDismiss }: Props) {
  if (Platform.OS !== 'android') {
    return null;
  }

  const handleRemoveRestriction = async () => {
    await requestIgnoreBatteryOptimizations();
    onDismiss();
  };

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      statusBarTranslucent
      onRequestClose={onDismiss}
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.iconContainer}>
            <Text style={styles.icon}>🔋</Text>
          </View>

          <Text style={styles.title}>{pt.battery_optimization_title}</Text>
          <Text style={styles.description}>
            {pt.battery_optimization_message}
          </Text>

          <View style={styles.actions}>
            <Pressable
              style={styles.primaryButton}
              onPress={handleRemoveRestriction}
            >
              <Text style={styles.primaryButtonText}>
                {pt.battery_optimization_action}
              </Text>
            </Pressable>

            <Pressable style={styles.secondaryButton} onPress={onDismiss}>
              <Text style={styles.secondaryButtonText}>
                {pt.battery_optimization_dismiss}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    paddingVertical: 28,
    paddingHorizontal: 24,
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
  },
  iconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#FFF3E0',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  icon: {
    fontSize: 28,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.onSurface,
    textAlign: 'center',
    marginBottom: 8,
  },
  description: {
    fontSize: 14,
    lineHeight: 20,
    color: '#6E6B7B',
    textAlign: 'center',
    marginBottom: 24,
  },
  actions: {
    width: '100%',
    gap: 10,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: colors.onPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  secondaryButton: {
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#6E6B7B',
    fontSize: 14,
    fontWeight: '500',
  },
});
