<script lang="ts" setup>
import { ref, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

type SelectValue = string | number | boolean | null;

interface SelectItem {
  id?: SelectValue;
  value?: SelectValue;
  name?: string;
  title?: string;
  text?: string;
  [key: string]: any;
}

const props = withDefaults(
  defineProps<{
    modelValue: SelectValue | SelectValue[];
    items: SelectItem[];
    placeholder?: string;
    label?: string;
    clearable?: boolean;
    disabled?: boolean;
    loading?: boolean;
    itemValue?: string;
    itemTitle?: string | ((item: SelectItem) => string);
    itemText?: string;
    noItemsText?: string;
    noResultsText?: string;
    rules?: Array<((value: any) => boolean | string) | (boolean | string)>;
    multiple?: boolean;
    chips?: boolean;
    closableChips?: boolean;
    search?: string;
  }>(),
  {
    placeholder: '',
    label: '',
    clearable: false,
    disabled: false,
    loading: false,
    itemValue: 'id',
    itemTitle: 'name',
    itemText: 'text',
    noItemsText: 'no_items_available',
    noResultsText: 'no_results_found',
    rules: () => [],
    multiple: false,
    chips: false,
    closableChips: false,
    search: '',
  }
);

const emit = defineEmits<{
  'update:modelValue': [value: SelectValue | SelectValue[]];
  'update:search': [value: string];
  select: [item: SelectItem];
  clear: [];
}>();

const isMenuOpen = ref(false);
const internalSearch = ref(props.search || '');
const containerRef = ref<HTMLElement | null>(null);

const attachElement = computed(() => containerRef.value || undefined);

const getItemValue = (item: SelectItem): string | number | boolean => {
  return item[props.itemValue] ?? item.value ?? item.id ?? '';
};

const getItemTitle = (item: SelectItem): string => {
  if (typeof props.itemTitle === 'function') {
    return props.itemTitle(item) || '';
  }
  return (
    item[props.itemTitle as string] ??
    item[props.itemText] ??
    item.title ??
    item.name ??
    item.text ??
    ''
  );
};

const selectedItem = computed(() => {
  if (props.multiple) {
    return [];
  }
  return props.items.find((item) => getItemValue(item) === props.modelValue);
});

const selectedItems = computed(() => {
  if (!props.multiple) {
    return [];
  }
  const values = Array.isArray(props.modelValue) ? props.modelValue : [];
  return props.items.filter((item) => values.includes(getItemValue(item)));
});

const displayValue = computed(() => {
  if (props.multiple) {
    return '';
  }
  return selectedItem.value ? getItemTitle(selectedItem.value) : '';
});

const hasSelectedItems = computed(() => {
  if (props.multiple) {
    return Array.isArray(props.modelValue) && props.modelValue.length > 0;
  }
  return !!props.modelValue;
});

const inputValue = computed(() => {
  if (props.multiple) {
    if (Array.isArray(props.modelValue)) {
      return String(props.modelValue.length || '');
    }
    return '';
  }
  return displayValue.value;
});

watch(
  () => props.search,
  (newValue) => {
    internalSearch.value = newValue || '';
  }
);

watch(internalSearch, (newValue) => {
  emit('update:search', newValue);
});

const computedRules = computed(() => {
  if (!props.rules || props.rules.length === 0) {
    return [];
  }
  if (isMenuOpen.value) {
    return [];
  }
  return props.rules
    .filter((rule) => rule != null)
    .map((rule) => {
      if (typeof rule === 'function') {
        return () => rule(props.modelValue);
      }
      return () => rule;
    });
});

const filteredItems = computed(() => {
  if (props.multiple && props.search !== undefined) {
    return props.items;
  }

  const query = internalSearch.value.toLowerCase();
  if (!query) {
    return props.items;
  }
  return props.items.filter((item) => {
    const title = getItemTitle(item).toLowerCase();
    return title.includes(query);
  });
});

watch(isMenuOpen, (isOpen) => {
  if (!isOpen) {
    if (props.multiple && props.search !== undefined) {
      internalSearch.value = '';
      emit('update:search', '');
    } else if (!props.multiple) {
      internalSearch.value = '';
    }
  }
});

const handleSelect = (item: SelectItem) => {
  const value = getItemValue(item);

  if (props.multiple) {
    const currentValues = Array.isArray(props.modelValue)
      ? props.modelValue
      : [];
    const valueIndex = currentValues.indexOf(value);

    if (valueIndex > -1) {
      const newValues = currentValues.filter((v) => v !== value);
      emit('update:modelValue', newValues);
    } else {
      emit('update:modelValue', [...currentValues, value]);
    }

    internalSearch.value = '';
  } else {
    emit('update:modelValue', value);
    emit('select', item);
    isMenuOpen.value = false;
    internalSearch.value = '';
  }
};

const handleRemove = (value: SelectValue) => {
  if (!props.multiple) {
    return;
  }
  const currentValues = Array.isArray(props.modelValue) ? props.modelValue : [];
  const newValues = currentValues.filter((v) => v !== value);
  emit('update:modelValue', newValues);
};

const handleClear = () => {
  if (props.multiple) {
    emit('update:modelValue', []);
  } else {
    emit('update:modelValue', null);
  }
  emit('clear');
};
</script>

<template>
  <div ref="containerRef">
    <VLabel v-if="label" class="mb-1 text-body-2"> {{ label }}: </VLabel>
    <VMenu
      v-model="isMenuOpen"
      location="bottom"
      :close-on-content-click="false"
      offset="0"
      :attach="attachElement"
    >
      <template #activator="{ props: menuProps }">
        <div class="select-field-wrapper">
          <VTextField
            v-bind="menuProps"
            :model-value="inputValue"
            :placeholder="hasSelectedItems ? '' : placeholder"
            variant="outlined"
            :readonly="true"
            :disabled="disabled"
            :loading="loading"
            :rules="computedRules"
            :class="{
              'select-with-chips': multiple && chips && hasSelectedItems,
            }"
          >
            <template v-if="$slots['prepend-inner']" #prepend-inner>
              <slot
                name="prepend-inner"
                :item="selectedItem"
                :items="selectedItems"
              />
            </template>
            <template #append-inner>
              <div class="d-flex align-center ga-1 append-inner-icons">
                <VIcon
                  v-if="
                    clearable &&
                    (multiple
                      ? Array.isArray(modelValue) && modelValue.length > 0
                      : modelValue)
                  "
                  icon="tabler-x"
                  class="cursor-pointer clear-icon"
                  @click.stop="handleClear"
                />
                <VIcon icon="tabler-chevron-down" class="chevron-icon" />
              </div>
            </template>
          </VTextField>
          <div
            v-if="multiple && chips && selectedItems.length > 0"
            class="chips-container"
          >
            <VChip
              v-for="item in selectedItems"
              :key="String(getItemValue(item))"
              size="small"
              :closable="closableChips"
              @click:close.stop="handleRemove(getItemValue(item))"
            >
              <template v-if="$slots['chip']">
                <slot name="chip" :item="item" />
              </template>
              <template v-else>
                {{ getItemTitle(item) }}
              </template>
            </VChip>
          </div>
        </div>
      </template>
      <VCard @click.stop class="select-menu-card">
        <VCardText class="pa-2">
          <AppTextField
            :model-value="internalSearch"
            @update:model-value="internalSearch = $event"
            :placeholder="t('search') + '...'"
            prepend-inner-icon="tabler-search"
            density="compact"
            hide-details
            autofocus
            @click.stop
          />
        </VCardText>
        <VDivider />
        <VList class="select-options-list">
          <template v-if="filteredItems.length > 0">
            <VListItem
              v-for="(item, index) in filteredItems"
              :key="index"
              :value="getItemValue(item)"
              @click.prevent="handleSelect(item)"
              :active="
                multiple
                  ? Array.isArray(modelValue) &&
                    modelValue.includes(getItemValue(item))
                  : getItemValue(item) === modelValue
              "
            >
              <template v-if="multiple" #prepend>
                <VCheckbox
                  :model-value="
                    Array.isArray(modelValue) &&
                    modelValue.includes(getItemValue(item))
                  "
                  @click.stop
                  @update:model-value="handleSelect(item)"
                  hide-details
                />
              </template>
              <template v-else-if="$slots['item-prepend']" #prepend>
                <slot name="item-prepend" :item="item" />
              </template>
              <VListItemTitle>
                <template v-if="$slots['item-title']">
                  <slot name="item-title" :item="item" />
                </template>
                <template v-else>
                  {{ getItemTitle(item) }}
                </template>
              </VListItemTitle>
            </VListItem>
          </template>
          <VListItem v-else disabled>
            <VListItemTitle
              class="text-center text-body-2 text-medium-emphasis"
            >
              {{ internalSearch ? t(noResultsText) : t(noItemsText) }}
            </VListItemTitle>
          </VListItem>
        </VList>
      </VCard>
    </VMenu>
  </div>
</template>

<style scoped>
:deep(.v-field) {
  .append-inner-icons .clear-icon {
    opacity: 0;
    transition: opacity 0.2s;
  }

  &:hover .append-inner-icons .clear-icon {
    opacity: 1;
  }
}

.select-field-wrapper {
  position: relative;
  width: 100%;
}

.chips-container {
  position: absolute;
  top: 50%;
  left: 14px;
  right: 80px;
  transform: translateY(-50%);
  display: flex;
  flex-wrap: nowrap;
  gap: 4px;
  align-items: center;
  pointer-events: none;
  z-index: 1;
  overflow: hidden;
  max-height: 32px;
}

.chips-container :deep(.v-chip) {
  pointer-events: auto;
}

.select-with-chips :deep(.v-field__input) {
  color: transparent;
  caret-color: transparent;
}

.select-with-chips :deep(input) {
  color: transparent;
}

:deep(.v-menu .v-overlay__content) {
  transform-origin: top left !important;
  margin-top: 0 !important;
}

.select-menu-card {
  margin-top: 0 !important;
  border-top-left-radius: 0 !important;
  border-top-right-radius: 0 !important;
}

.select-options-list {
  max-height: 280px;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: thin;
  scrollbar-color: rgba(var(--v-theme-on-surface), 0.2) transparent;
}

.select-options-list::-webkit-scrollbar {
  width: 6px;
}

.select-options-list::-webkit-scrollbar-track {
  background: transparent;
}

.select-options-list::-webkit-scrollbar-thumb {
  background: rgba(var(--v-theme-on-surface), 0.2);
  border-radius: 3px;
  transition: background 0.2s ease;
}

.select-options-list::-webkit-scrollbar-thumb:hover {
  background: rgba(var(--v-theme-on-surface), 0.3);
}
</style>
