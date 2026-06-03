import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { pt } from '../locales/pt';

type Props = {
  error?: string | null;
  loading?: boolean;
  onUnlock: () => void;
  onUsePassword: () => void;
};

export function BiometricLockScreen({
  error = null,
  loading = false,
  onUnlock,
  onUsePassword,
}: Props) {
  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <View style={styles.content}>
        <View style={styles.iconWrap}>
          <Ionicons
            name="finger-print-outline"
            size={54}
            color={colors.primary}
          />
        </View>
        <Text style={styles.title}>{pt.biometric_unlock_title}</Text>
        <Text style={styles.description}>
          {pt.biometric_unlock_description}
        </Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.actions}>
          <Pressable
            style={[styles.primaryButton, loading && styles.buttonDisabled]}
            onPress={onUnlock}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <>
                <Ionicons
                  name="finger-print-outline"
                  size={22}
                  color={colors.onPrimary}
                />
                <Text style={styles.primaryButtonText}>
                  {pt.biometric_unlock}
                </Text>
              </>
            )}
          </Pressable>

          <Pressable
            style={[styles.secondaryButton, loading && styles.buttonDisabled]}
            onPress={onUsePassword}
            disabled={loading}
          >
            <Text style={styles.secondaryButtonText}>
              {pt.biometric_use_password}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  content: {
    width: '100%',
    maxWidth: 420,
    alignItems: 'center',
  },
  iconWrap: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.grey100,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.onSurface,
    textAlign: 'center',
  },
  description: {
    marginTop: 8,
    fontSize: 15,
    lineHeight: 22,
    color: colors.grey600,
    textAlign: 'center',
  },
  error: {
    marginTop: 14,
    fontSize: 14,
    lineHeight: 20,
    color: colors.error,
    textAlign: 'center',
  },
  actions: {
    width: '100%',
    gap: 10,
    marginTop: 24,
  },
  primaryButton: {
    minHeight: 50,
    borderRadius: 8,
    ...(Platform.OS === 'ios' && { borderCurve: 'continuous' as const }),
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  secondaryButton: {
    minHeight: 48,
    borderRadius: 8,
    ...(Platform.OS === 'ios' && { borderCurve: 'continuous' as const }),
    borderWidth: 1,
    borderColor: colors.grey300,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  buttonDisabled: {
    opacity: 0.65,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.onPrimary,
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.onSurface,
    textAlign: 'center',
  },
});
