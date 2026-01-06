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
    modelValue: SelectValue;
    items: SelectItem[];
    placeholder?: string;
    label?: string;
    clearable?: boolean;
    disabled?: boolean;
    loading?: boolean;
    itemValue?: string;
    itemTitle?: string;
    itemText?: string;
    noItemsText?: string;
    noResultsText?: string;
    rules?: Array<((value: any) => boolean | string) | (boolean | string)>;
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
  }
);

const emit = defineEmits<{
  'update:modelValue': [value: SelectValue];
  select: [item: SelectItem];
  clear: [];
}>();

const isMenuOpen = ref(false);
const searchQuery = ref('');

const getItemValue = (item: SelectItem): string | number | boolean => {
  return item[props.itemValue] ?? item.value ?? item.id ?? '';
};

const getItemTitle = (item: SelectItem): string => {
  return (
    item[props.itemTitle] ??
    item[props.itemText] ??
    item.title ??
    item.name ??
    item.text ??
    ''
  );
};

const selectedItem = computed(() => {
  return props.items.find((item) => getItemValue(item) === props.modelValue);
});

const displayValue = computed(() => {
  return selectedItem.value ? getItemTitle(selectedItem.value) : '';
});

const computedRules = computed(() => {
  if (!props.rules || props.rules.length === 0) {
    return [];
  }
  return props.rules
    .filter((rule) => rule != null)
    .map((rule) => {
      if (typeof rule === 'function') {
        return (value: any) => rule(props.modelValue);
      }
      return () => rule;
    });
});

const filteredItems = computed(() => {
  if (!searchQuery.value) {
    return props.items;
  }
  const query = searchQuery.value.toLowerCase();
  return props.items.filter((item) => {
    const title = getItemTitle(item).toLowerCase();
    return title.includes(query);
  });
});

watch(isMenuOpen, (isOpen) => {
  if (!isOpen) {
    searchQuery.value = '';
  }
});

const handleSelect = (item: SelectItem) => {
  const value = getItemValue(item);
  emit('update:modelValue', value);
  emit('select', item);
  isMenuOpen.value = false;
  searchQuery.value = '';
};

const handleClear = () => {
  emit('update:modelValue', null);
  emit('clear');
};
</script>

<template>
  <div>
    <VLabel v-if="label" class="mb-1 text-body-2"> {{ label }}: </VLabel>
    <VMenu v-model="isMenuOpen">
      <template #activator="{ props: menuProps }">
        <VTextField
          v-bind="menuProps"
          :model-value="displayValue"
          :placeholder="placeholder"
          variant="outlined"
          readonly
          :disabled="disabled"
          :loading="loading"
          :rules="computedRules"
        >
          <template v-if="$slots['prepend-inner']" #prepend-inner>
            <slot name="prepend-inner" :item="selectedItem" />
          </template>
          <template #append-inner>
            <div class="d-flex align-center ga-1 append-inner-icons">
              <VIcon
                v-if="clearable && modelValue"
                icon="tabler-x"
                class="cursor-pointer clear-icon"
                @click.stop="handleClear"
              />
              <VIcon icon="tabler-chevron-down" class="chevron-icon" />
            </div>
          </template>
        </VTextField>
      </template>
      <VCard>
        <VCardText class="pa-2">
          <AppTextField
            v-model="searchQuery"
            :placeholder="t('search') + '...'"
            prepend-inner-icon="tabler-search"
            density="compact"
            hide-details
            autofocus
            @click.stop
          />
        </VCardText>
        <VDivider />
        <VList max-height="300" style="overflow-y: auto">
          <template v-if="filteredItems.length > 0">
            <VListItem
              v-for="(item, index) in filteredItems"
              :key="index"
              :value="getItemValue(item)"
              @click="handleSelect(item)"
              :active="getItemValue(item) === modelValue"
            >
              <template v-if="$slots['item-prepend']" #prepend>
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
              {{ searchQuery ? t(noResultsText) : t(noItemsText) }}
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
</style>
