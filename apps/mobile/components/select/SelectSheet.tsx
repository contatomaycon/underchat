import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import type { SelectOption } from './types';
import { selectTokens } from './tokens';

export interface SelectSheetProps {
  visible: boolean;
  title: string;
  options: SelectOption[];
  selectedValue?: string | null;
  selectedValues?: string[];
  multiple?: boolean;
  loading?: boolean;
  emptyText: string;
  searchPlaceholder: string;
  clearLabel?: string;
  doneLabel?: string;
  showClear?: boolean;
  showDone?: boolean;
  onRequestClose: () => void;
  onSelectValue: (value: string) => void;
  onToggleValue?: (value: string) => void;
  onClear?: () => void;
  onDone?: () => void;
}

export function SelectSheet({
  visible,
  title,
  options,
  selectedValue = null,
  selectedValues = [],
  multiple = false,
  loading = false,
  emptyText,
  searchPlaceholder,
  clearLabel,
  doneLabel,
  showClear = false,
  showDone = false,
  onRequestClose,
  onSelectValue,
  onToggleValue,
  onClear,
  onDone,
}: SelectSheetProps) {
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!visible) {
      setSearch('');
    }
  }, [visible]);

  const normalizedSearch = search.trim().toLocaleLowerCase();

  const filteredOptions = useMemo(() => {
    if (!normalizedSearch) {
      return options;
    }

    return options.filter((item) =>
      item.label.toLocaleLowerCase().includes(normalizedSearch)
    );
  }, [normalizedSearch, options]);

  const handleClose = () => {
    setSearch('');
    onRequestClose();
  };

  const handlePressOption = (value: string) => {
    if (multiple) {
      onToggleValue?.(value);
      return;
    }

    onSelectValue(value);
  };

  const isSelected = (value: string): boolean => {
    if (multiple) {
      return selectedValues.includes(value);
    }

    return selectedValue === value;
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      presentationStyle="overFullScreen"
      statusBarTranslucent
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        style={styles.keyboardAvoiding}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <Pressable style={styles.overlay} onPress={handleClose}>
          <Pressable
            style={styles.card}
            onPress={(event) => {
              event.stopPropagation();
            }}
          >
            <View style={styles.handle} />

            <View style={styles.header}>
              <Text style={styles.title} numberOfLines={1}>
                {title}
              </Text>

              <View style={styles.actionsRow}>
                {showClear && onClear ? (
                  <Pressable
                    style={styles.actionButton}
                    onPress={() => {
                      onClear();
                      handleClose();
                    }}
                  >
                    <Text style={styles.actionButtonText}>{clearLabel}</Text>
                  </Pressable>
                ) : null}

                {showDone && onDone ? (
                  <Pressable
                    style={styles.actionButton}
                    onPress={() => {
                      onDone();
                      handleClose();
                    }}
                  >
                    <Text style={styles.actionButtonText}>{doneLabel}</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>

            <View style={styles.searchRow}>
              <Ionicons
                name="search-outline"
                size={18}
                color={colors.grey600}
              />
              <TextInput
                value={search}
                onChangeText={setSearch}
                style={styles.searchInput}
                placeholder={searchPlaceholder}
                placeholderTextColor={colors.grey500}
                autoCorrect={false}
                autoCapitalize="none"
                clearButtonMode="while-editing"
              />
            </View>

            {loading ? (
              <View style={styles.loadingWrap}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            ) : (
              <FlatList
                data={filteredOptions}
                keyExtractor={(item) => item.value}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                initialNumToRender={20}
                windowSize={7}
                renderItem={({ item }) => {
                  const selected = isSelected(item.value);
                  return (
                    <Pressable
                      style={({ pressed }) => [
                        styles.optionRow,
                        selected && styles.optionRowSelected,
                        pressed && styles.optionRowPressed,
                      ]}
                      onPress={() => handlePressOption(item.value)}
                      disabled={item.disabled}
                    >
                      <Text
                        style={[
                          styles.optionText,
                          item.disabled && styles.optionTextDisabled,
                        ]}
                        numberOfLines={2}
                      >
                        {item.label}
                      </Text>
                      {selected ? (
                        <Ionicons
                          name="checkmark-circle"
                          size={18}
                          color={colors.primary}
                        />
                      ) : null}
                    </Pressable>
                  );
                }}
                ListEmptyComponent={
                  <Text style={styles.emptyText}>{emptyText}</Text>
                }
              />
            )}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  keyboardAvoiding: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    backgroundColor: selectTokens.sheetOverlayColor,
    justifyContent: 'flex-end',
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  card: {
    width: '100%',
    maxHeight: selectTokens.sheetMaxHeightPercent,
    borderRadius: selectTokens.sheetRadius,
    backgroundColor: selectTokens.sheetBackground,
    padding: selectTokens.sheetPadding,
  },
  handle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 999,
    backgroundColor: colors.grey300,
    marginBottom: 10,
  },
  header: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 8,
  },
  title: {
    flex: 1,
    color: colors.onSurface,
    fontSize: 16,
    fontWeight: '700',
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionButton: {
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  actionButtonText: {
    color: selectTokens.actionTextColor,
    fontSize: 13,
    fontWeight: '600',
  },
  searchRow: {
    minHeight: selectTokens.searchInputHeight,
    borderRadius: selectTokens.searchInputRadius,
    backgroundColor: selectTokens.searchInputBg,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 8,
    marginBottom: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: colors.onSurface,
    paddingVertical: 0,
  },
  loadingWrap: {
    minHeight: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionRow: {
    minHeight: selectTokens.optionMinHeight,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: selectTokens.optionDividerColor,
    paddingHorizontal: selectTokens.optionHorizontalPadding,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 8,
    backgroundColor: colors.surface,
  },
  optionRowSelected: {
    backgroundColor: selectTokens.optionSelectedBg,
    borderColor: 'rgba(40, 101, 183, 0.32)',
  },
  optionRowPressed: {
    backgroundColor: selectTokens.optionPressedBg,
  },
  optionText: {
    flex: 1,
    color: colors.onSurface,
    fontSize: 14,
  },
  optionTextDisabled: {
    color: colors.grey500,
  },
  emptyText: {
    color: colors.grey700,
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 18,
  },
});
