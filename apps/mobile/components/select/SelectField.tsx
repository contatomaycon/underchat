import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { StyleProp, ViewStyle } from 'react-native';
import { colors } from '../../theme/colors';
import { selectTokens } from './tokens';

export interface SelectFieldProps {
  label?: string;
  valueLabel?: string | null;
  placeholder: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  required?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
  fieldStyle?: StyleProp<ViewStyle>;
}

export function SelectField({
  label,
  valueLabel,
  placeholder,
  onPress,
  disabled = false,
  loading = false,
  required = false,
  containerStyle,
  fieldStyle,
}: SelectFieldProps) {
  const hasValue = !!valueLabel && valueLabel.trim().length > 0;

  return (
    <View style={containerStyle}>
      {label ? (
        <Text style={styles.label}>
          {label}
          {required ? <Text style={styles.required}> *</Text> : null}
        </Text>
      ) : null}

      <Pressable
        style={({ pressed }) => [
          styles.field,
          disabled && styles.fieldDisabled,
          pressed && !disabled && styles.fieldPressed,
          fieldStyle,
        ]}
        onPress={onPress}
        disabled={disabled || loading}
      >
        <Text
          style={[styles.valueText, !hasValue && styles.placeholderText]}
          numberOfLines={1}
        >
          {hasValue ? valueLabel : placeholder}
        </Text>

        {loading ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Ionicons
            name="chevron-down"
            size={18}
            color={disabled ? colors.grey500 : colors.grey600}
          />
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: selectTokens.fieldLabelSize,
    color: selectTokens.fieldLabelColor,
    marginBottom: 5,
    fontWeight: '600',
  },
  required: {
    color: colors.error,
  },
  field: {
    minHeight: selectTokens.fieldHeight,
    borderRadius: selectTokens.fieldRadius,
    borderWidth: 1,
    borderColor: selectTokens.fieldBorderColor,
    backgroundColor: selectTokens.fieldBackground,
    paddingHorizontal: selectTokens.fieldPaddingHorizontal,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  fieldDisabled: {
    borderColor: selectTokens.fieldBorderColorDisabled,
    backgroundColor: colors.grey100,
  },
  fieldPressed: {
    backgroundColor: selectTokens.optionPressedBg,
  },
  valueText: {
    flex: 1,
    fontSize: selectTokens.valueSize,
    color: selectTokens.valueColor,
  },
  placeholderText: {
    color: selectTokens.placeholderColor,
  },
});
