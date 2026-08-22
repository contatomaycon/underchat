import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { pt } from '../locales/pt';
import { colors } from '../theme/colors';
import type {
  OfficialTemplate,
  OfficialTemplateVariableComponent,
  OfficialTemplateVariableValue,
} from '../types/chat';
import {
  buildOfficialTemplatePreview,
  createOfficialTemplateOptions,
  findOfficialTemplate,
  formatOfficialTemplateVariableLabel,
} from '../utils/officialTemplate';
import { SelectField } from './select';

const MANUAL_VARIABLE_COMPONENTS: OfficialTemplateVariableComponent[] = [
  'HEADER',
  'BODY',
  'BUTTON',
];

const OFFICIAL_VALUE_VARIABLES = [
  { tag: '{{ name }}', label: 'Nome' },
  { tag: '{{ greeting }}', label: 'Saudação' },
  { tag: '{{ protocol }}', label: 'Protocolo' },
  { tag: '{{ date }}', label: 'Data' },
  { tag: '{{ time }}', label: 'Hora' },
  { tag: '{{ account_name }}', label: 'Conta' },
  { tag: '{{ channel_name }}', label: 'Canal' },
  { tag: '{{ phone }}', label: 'Telefone' },
  { tag: '{{ sector }}', label: 'Setor' },
  { tag: '{{ user }}', label: 'Atendente' },
] as const;

type ManualVariablePatch = Partial<
  Pick<
    OfficialTemplateVariableValue,
    'component_type' | 'index' | 'button_index'
  >
>;

type OfficialTemplateFieldsProps = {
  templates: OfficialTemplate[];
  selectedTemplateKey: string | null;
  variableValues: OfficialTemplateVariableValue[];
  loading?: boolean;
  error?: string | null;
  submitting?: boolean;
  style?: StyleProp<ViewStyle>;
  onOpenTemplatePicker: () => void;
  onChangeVariableValue: (key: string, value: string) => void;
  onChangeManualVariable?: (key: string, patch: ManualVariablePatch) => void;
  onAddManualVariable?: () => void;
  onRemoveManualVariable?: (key: string) => void;
};

function parseManualVariableIndex(
  value: string,
  fallback: number,
  min: number
): number {
  const parsed = Number(value.replace(/\D/g, ''));
  if (!Number.isFinite(parsed) || parsed < min) return fallback;
  return parsed;
}

export function OfficialTemplateFields({
  templates,
  selectedTemplateKey,
  variableValues,
  loading = false,
  error = null,
  submitting = false,
  style,
  onOpenTemplatePicker,
  onChangeVariableValue,
  onChangeManualVariable,
  onAddManualVariable,
  onRemoveManualVariable,
}: OfficialTemplateFieldsProps) {
  const [activeVariableCatalogKey, setActiveVariableCatalogKey] = useState<
    string | null
  >(null);
  const options = createOfficialTemplateOptions(templates, 'pt');
  const selectedOption =
    options.find((item) => item.value === selectedTemplateKey) ?? null;
  const selectedTemplate = findOfficialTemplate(templates, selectedTemplateKey);
  const preview = buildOfficialTemplatePreview(
    selectedTemplate,
    variableValues,
    selectedTemplate?.variables.length ? selectedTemplate.variables : undefined
  );
  const hasDetectedVariables = (selectedTemplate?.variables.length ?? 0) > 0;
  const variablesToRender = hasDetectedVariables
    ? variableValues
    : variableValues.filter((variable) => variable.value !== undefined);
  const canAddManualVariable =
    !!selectedTemplate && !hasDetectedVariables && !!onAddManualVariable;

  const insertValueVariable = (
    variable: OfficialTemplateVariableValue,
    tag: string
  ) => {
    const currentValue =
      typeof variable.value === 'number'
        ? Number.isFinite(variable.value)
          ? String(variable.value)
          : ''
        : variable.value.trimEnd();
    const separator = currentValue.length > 0 ? ' ' : '';
    onChangeVariableValue(variable.key, `${currentValue}${separator}${tag}`);
  };

  if (loading) {
    return (
      <View style={[styles.panel, styles.centerPanel, style]}>
        <ActivityIndicator size="small" color={colors.primary} />
        <Text style={styles.mutedText}>{pt.official_templates_loading}</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.panel, styles.errorPanel, style]}>
        <Ionicons name="alert-circle-outline" size={18} color={colors.error} />
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  if (templates.length === 0) {
    return (
      <View style={[styles.panel, styles.warningPanel, style]}>
        <Ionicons name="warning-outline" size={18} color="#B45309" />
        <Text style={styles.warningText}>{pt.official_templates_empty}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.panel, style]}>
      <SelectField
        label={pt.official_template_model}
        required
        valueLabel={selectedOption?.label ?? null}
        placeholder={pt.select_official_template}
        onPress={onOpenTemplatePicker}
        disabled={submitting}
      />

      {selectedTemplate && selectedOption ? (
        <View style={styles.templateContent}>
          <View style={styles.chipRow}>
            <View style={[styles.chip, styles.successChip]}>
              <Ionicons
                name="checkmark-circle-outline"
                size={14}
                color="#128C52"
              />
              <Text style={[styles.chipText, styles.successChipText]}>
                {pt.approved}
              </Text>
            </View>
            <View style={styles.chip}>
              <Ionicons
                name="language-outline"
                size={14}
                color={colors.primary}
              />
              <Text style={styles.chipText}>
                {selectedOption.languageLabel}
              </Text>
            </View>
            {selectedOption.category ? (
              <View style={styles.chip}>
                <Ionicons
                  name="pricetag-outline"
                  size={14}
                  color={colors.primary}
                />
                <Text style={styles.chipText}>{selectedOption.category}</Text>
              </View>
            ) : null}
          </View>

          {hasDetectedVariables || canAddManualVariable ? (
            <View style={styles.variablesBlock}>
              <View style={styles.variablesHeader}>
                <Text style={styles.sectionTitle}>
                  {hasDetectedVariables
                    ? pt.official_template_available_variables
                    : pt.chatbot_message_variables_legend}
                </Text>
                {canAddManualVariable ? (
                  <Pressable
                    style={styles.addVariableBtn}
                    onPress={onAddManualVariable}
                    disabled={submitting}
                  >
                    <Ionicons name="add" size={16} color={colors.primary} />
                    <Text style={styles.addVariableBtnText}>{pt.add}</Text>
                  </Pressable>
                ) : null}
              </View>

              {variablesToRender.map((variable) => (
                <View key={variable.key} style={styles.variableRow}>
                  <Text style={styles.variableLabel}>
                    {formatOfficialTemplateVariableLabel(variable)}
                  </Text>
                  {!hasDetectedVariables && onChangeManualVariable ? (
                    <View style={styles.manualVariableControls}>
                      <View style={styles.componentTypeRow}>
                        {MANUAL_VARIABLE_COMPONENTS.map((componentType) => {
                          const active =
                            variable.component_type === componentType;
                          return (
                            <Pressable
                              key={componentType}
                              style={[
                                styles.componentTypeChip,
                                active && styles.componentTypeChipActive,
                              ]}
                              onPress={() =>
                                onChangeManualVariable(variable.key, {
                                  component_type: componentType,
                                  button_index:
                                    componentType === 'BUTTON'
                                      ? (variable.button_index ?? 0)
                                      : null,
                                })
                              }
                              disabled={submitting}
                            >
                              <Text
                                style={[
                                  styles.componentTypeChipText,
                                  active && styles.componentTypeChipTextActive,
                                ]}
                              >
                                {componentType}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                      <View style={styles.manualVariableNumberRow}>
                        <View style={styles.manualVariableNumberField}>
                          <Text style={styles.manualVariableNumberLabel}>
                            {pt.template_variable_index}
                          </Text>
                          <TextInput
                            style={styles.manualVariableNumberInput}
                            value={String(variable.index)}
                            onChangeText={(value) =>
                              onChangeManualVariable(variable.key, {
                                index: parseManualVariableIndex(
                                  value,
                                  variable.index,
                                  1
                                ),
                              })
                            }
                            editable={!submitting}
                            keyboardType="number-pad"
                          />
                        </View>
                        {variable.component_type === 'BUTTON' ? (
                          <View style={styles.manualVariableNumberField}>
                            <Text style={styles.manualVariableNumberLabel}>
                              {pt.template_variable_button_index}
                            </Text>
                            <TextInput
                              style={styles.manualVariableNumberInput}
                              value={String(variable.button_index ?? 0)}
                              onChangeText={(value) =>
                                onChangeManualVariable(variable.key, {
                                  button_index: parseManualVariableIndex(
                                    value,
                                    variable.button_index ?? 0,
                                    0
                                  ),
                                })
                              }
                              editable={!submitting}
                              keyboardType="number-pad"
                            />
                          </View>
                        ) : null}
                      </View>
                    </View>
                  ) : null}
                  <View style={styles.variableInputRow}>
                    <TextInput
                      style={styles.variableInput}
                      value={
                        typeof variable.value === 'number'
                          ? Number.isFinite(variable.value)
                            ? String(variable.value)
                            : ''
                          : variable.value
                      }
                      onChangeText={(value) =>
                        onChangeVariableValue(variable.key, value)
                      }
                      editable={!submitting}
                      placeholder={pt.template_variable_value}
                      placeholderTextColor={colors.grey500}
                    />
                    {!hasDetectedVariables && onRemoveManualVariable ? (
                      <Pressable
                        style={styles.removeVariableBtn}
                        onPress={() => onRemoveManualVariable(variable.key)}
                        disabled={submitting}
                        accessibilityLabel={pt.remove}
                      >
                        <Ionicons
                          name="trash-outline"
                          size={17}
                          color={colors.error}
                        />
                      </Pressable>
                    ) : null}
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    style={styles.variableCatalogToggle}
                    onPress={() =>
                      setActiveVariableCatalogKey((current) =>
                        current === variable.key ? null : variable.key
                      )
                    }
                    disabled={submitting}
                  >
                    <View style={styles.variableCatalogToggleIcon}>
                      <Text style={styles.variableCatalogToggleIconText}>
                        {'{ }'}
                      </Text>
                    </View>
                    <Text style={styles.variableCatalogToggleText}>
                      {pt.official_template_insert_variable}
                    </Text>
                    <Ionicons
                      name={
                        activeVariableCatalogKey === variable.key
                          ? 'chevron-up'
                          : 'chevron-down'
                      }
                      size={15}
                      color={colors.primary}
                    />
                  </Pressable>
                  {activeVariableCatalogKey === variable.key ? (
                    <View style={styles.variableCatalog}>
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.variableCatalogContent}
                        keyboardShouldPersistTaps="handled"
                      >
                        {OFFICIAL_VALUE_VARIABLES.map((availableVariable) => (
                          <Pressable
                            key={availableVariable.tag}
                            accessibilityRole="button"
                            style={styles.variableCatalogChip}
                            onPress={() =>
                              insertValueVariable(
                                variable,
                                availableVariable.tag
                              )
                            }
                            disabled={submitting}
                          >
                            <Text style={styles.variableCatalogChipLabel}>
                              {availableVariable.label}
                            </Text>
                            <Text style={styles.variableCatalogChipTag}>
                              {availableVariable.tag}
                            </Text>
                          </Pressable>
                        ))}
                      </ScrollView>
                      <Text style={styles.variableCatalogHint}>
                        {pt.official_template_variables_resolved_hint}
                      </Text>
                    </View>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}

          {preview ? (
            <View style={styles.previewCard}>
              <View style={styles.previewHeader}>
                <Ionicons name="logo-whatsapp" size={16} color="#128C52" />
                <Text style={styles.previewName} numberOfLines={1}>
                  {selectedTemplate.name}
                </Text>
              </View>
              {preview.header ? (
                <Text style={styles.previewTitle}>{preview.header}</Text>
              ) : null}
              {preview.body ? (
                <Text style={styles.previewBody}>{preview.body}</Text>
              ) : null}
              {preview.footer ? (
                <Text style={styles.previewFooter}>{preview.footer}</Text>
              ) : null}
              {preview.buttons && preview.buttons.length > 0 ? (
                <View style={styles.previewButtons}>
                  {preview.buttons.map((button, index) => (
                    <View
                      key={`official-preview-button-${index}-${button}`}
                      style={styles.previewButton}
                    >
                      <Ionicons
                        name="sparkles-outline"
                        size={14}
                        color={colors.primary}
                      />
                      <Text style={styles.previewButtonText} numberOfLines={2}>
                        {button}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderWidth: 1,
    borderColor: '#BEEFD4',
    borderRadius: 8,
    backgroundColor: '#ECFDF5',
    padding: 12,
    gap: 12,
  },
  centerPanel: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 72,
  },
  errorPanel: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  warningPanel: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  mutedText: {
    color: colors.grey700,
    fontSize: 13,
  },
  errorText: {
    flex: 1,
    color: colors.error,
    fontSize: 13,
  },
  warningText: {
    flex: 1,
    color: '#92400E',
    fontSize: 13,
  },
  templateContent: {
    gap: 12,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 6,
    backgroundColor: '#DBEAFE',
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  successChip: {
    backgroundColor: '#DCFCE7',
  },
  chipText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '600',
  },
  successChipText: {
    color: '#128C52',
  },
  variablesBlock: {
    gap: 10,
  },
  variablesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  sectionTitle: {
    flex: 1,
    color: colors.grey700,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  addVariableBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  addVariableBtnText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '600',
  },
  variableRow: {
    gap: 5,
  },
  variableLabel: {
    color: colors.grey700,
    fontSize: 12,
    fontWeight: '600',
  },
  manualVariableControls: {
    gap: 8,
  },
  componentTypeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  componentTypeChip: {
    borderWidth: 1,
    borderColor: colors.grey300,
    borderRadius: 6,
    backgroundColor: colors.surface,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  componentTypeChipActive: {
    borderColor: colors.primary,
    backgroundColor: '#DBEAFE',
  },
  componentTypeChipText: {
    color: colors.grey700,
    fontSize: 12,
    fontWeight: '700',
  },
  componentTypeChipTextActive: {
    color: colors.primary,
  },
  manualVariableNumberRow: {
    flexDirection: 'row',
    gap: 8,
  },
  manualVariableNumberField: {
    flex: 1,
    gap: 4,
  },
  manualVariableNumberLabel: {
    color: colors.grey600,
    fontSize: 11,
    fontWeight: '600',
  },
  manualVariableNumberInput: {
    minHeight: 38,
    borderWidth: 1,
    borderColor: colors.grey300,
    borderRadius: 8,
    backgroundColor: colors.surface,
    color: colors.onSurface,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  variableInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  variableInput: {
    flex: 1,
    minHeight: 40,
    borderWidth: 1,
    borderColor: colors.grey300,
    borderRadius: 8,
    backgroundColor: colors.surface,
    color: colors.onSurface,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  variableCatalogToggle: {
    minHeight: 34,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 9,
    borderCurve: 'continuous',
    paddingHorizontal: 4,
  },
  variableCatalogToggleIcon: {
    minWidth: 30,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderCurve: 'continuous',
    backgroundColor: '#E0F2FE',
  },
  variableCatalogToggleIconText: {
    color: '#0369A1',
    fontSize: 11,
    fontWeight: '800',
  },
  variableCatalogToggleText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '700',
  },
  variableCatalog: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#BAE6FD',
    borderRadius: 12,
    borderCurve: 'continuous',
    backgroundColor: '#F0F9FF',
    paddingVertical: 9,
    gap: 7,
  },
  variableCatalogContent: {
    gap: 7,
    paddingHorizontal: 9,
  },
  variableCatalogChip: {
    minHeight: 44,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#BAE6FD',
    borderRadius: 10,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
    paddingHorizontal: 10,
    gap: 1,
  },
  variableCatalogChipLabel: {
    color: '#0C4A6E',
    fontSize: 11,
    fontWeight: '700',
  },
  variableCatalogChipTag: {
    color: '#0284C7',
    fontSize: 11,
    fontWeight: '600',
  },
  variableCatalogHint: {
    color: '#475569',
    fontSize: 10,
    lineHeight: 14,
    paddingHorizontal: 9,
  },
  removeVariableBtn: {
    width: 40,
    height: 40,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FEE2E2',
  },
  previewCard: {
    borderWidth: 1,
    borderColor: colors.grey200,
    borderRadius: 8,
    backgroundColor: colors.surface,
    padding: 12,
    gap: 8,
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  previewName: {
    flex: 1,
    color: '#047857',
    fontSize: 13,
    fontWeight: '700',
  },
  previewTitle: {
    color: colors.onSurface,
    fontSize: 14,
    fontWeight: '700',
  },
  previewBody: {
    color: colors.onSurface,
    fontSize: 14,
    lineHeight: 20,
  },
  previewFooter: {
    color: colors.grey600,
    fontSize: 12,
  },
  previewButtons: {
    borderTopWidth: 1,
    borderTopColor: colors.grey200,
    gap: 4,
    paddingTop: 4,
  },
  previewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 36,
  },
  previewButtonText: {
    flexShrink: 1,
    color: colors.primary,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
});
