import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { login } from '../api/authApi';
import {
  setToken,
  setUser,
  setPermissions,
  setSectors,
  setChannels,
  clearAuth,
} from '../storage/authStorage';
import { hasChatAccessPermission } from '../constants/chatAuthorization';
import { pt } from '../locales/pt';
import { colors } from '../theme/colors';

const APP_TITLE = pt.app_title;

type Props = {
  onLoginSuccess: () => void;
  initialError?: string | null;
};

export function LoginScreen({ onLoginSuccess, initialError = null }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const emailTrimmed = email.trim();
  const canSubmit = emailTrimmed.length > 0 && password.length >= 4 && !loading;

  useEffect(() => {
    if (!initialError) return;
    setError(initialError);
  }, [initialError]);

  const handleSubmit = async () => {
    if (!canSubmit) return;

    const emailError = !emailTrimmed ? pt.email_required : '';
    const passwordError = password.length < 4 ? pt.password_required : '';

    if (emailError || passwordError) {
      setError(emailError || passwordError);
      return;
    }

    setError('');
    setLoading(true);

    let result;
    try {
      result = await login(emailTrimmed, password);
    } catch (err) {
      setLoading(false);
      setError(pt.network_error);
      return;
    }

    setLoading(false);

    if (result.success) {
      const permissions = result.data.permissions ?? [];
      const channels = result.data.channels ?? [];

      if (!hasChatAccessPermission(permissions)) {
        await clearAuth();
        setError(pt.chat_permission_denied);
        return;
      }

      await setToken(result.data.token);
      await setUser(result.data.user);
      await setPermissions(permissions);
      await setSectors(result.data.sectors ?? []);
      await setChannels(channels);
      onLoginSuccess();
      return;
    }

    setError(result.message);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
      >
        <View style={styles.card}>
          <Text style={styles.title}>
            {pt.welcome} {APP_TITLE}!
          </Text>
          <Text style={styles.subtitle}>{pt.please_login}</Text>

          <View style={styles.form}>
            <Text style={styles.label}>{pt.email}:</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder={pt.email_placeholder}
              placeholderTextColor={styles.placeholder.color}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              editable={!loading}
            />

            <Text style={styles.label}>{pt.password}:</Text>
            <View style={styles.passwordInputWrap}>
              <TextInput
                style={styles.inputWithIcon}
                value={password}
                onChangeText={setPassword}
                placeholder={pt.password_placeholder}
                placeholderTextColor={styles.placeholder.color}
                secureTextEntry={!passwordVisible}
                editable={!loading}
              />
              <Pressable
                style={styles.passwordIcon}
                onPress={() => setPasswordVisible((v) => !v)}
                disabled={loading}
              >
                <Ionicons
                  name={passwordVisible ? 'eye-off-outline' : 'eye-outline'}
                  size={22}
                  color={colors.grey600}
                />
              </Pressable>
            </View>

            <Pressable
              style={styles.forgotLink}
              onPress={() => {}}
              disabled={loading}
            >
              <Text style={styles.link}>{pt.forgot_password}</Text>
            </Pressable>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              style={[styles.button, !canSubmit && styles.buttonDisabled]}
              onPress={handleSubmit}
              disabled={!canSubmit}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>{pt.login}</Text>
              )}
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
    paddingVertical: 48,
  },
  card: {
    maxWidth: 500,
    width: '100%',
    alignSelf: 'center',
    gap: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: '600',
    color: colors.onSurface,
  },
  subtitle: {
    fontSize: 14,
    color: colors.grey600,
    marginBottom: 8,
  },
  form: {
    gap: 12,
  },
  label: {
    fontSize: 12,
    color: colors.grey800,
    marginBottom: -4,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.grey300,
    borderRadius: 8,
    ...(Platform.OS === 'ios' && { borderCurve: 'continuous' as const }),
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.onSurface,
  },
  passwordInputWrap: {
    position: 'relative',
  },
  inputWithIcon: {
    borderWidth: 1,
    borderColor: colors.grey300,
    borderRadius: 8,
    ...(Platform.OS === 'ios' && { borderCurve: 'continuous' as const }),
    paddingHorizontal: 12,
    paddingVertical: 12,
    paddingRight: 44,
    fontSize: 16,
    color: colors.onSurface,
  },
  passwordIcon: {
    position: 'absolute',
    right: 12,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  placeholder: {
    color: colors.grey500,
  },
  forgotLink: {
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  link: {
    fontSize: 14,
    color: colors.primary,
  },
  error: {
    fontSize: 14,
    color: colors.error,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    ...(Platform.OS === 'ios' && { borderCurve: 'continuous' as const }),
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.onPrimary,
  },
});
