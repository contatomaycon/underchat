<script lang="ts" setup>
import { useExpenditureStore } from '@/@webcore/stores/expenditure';
import { VForm } from 'vuetify/components/VForm';
import { UpdateExpenditureRequest } from '@core/schema/expenditure/updateExpenditure/request.schema';

const expenditureStore = useExpenditureStore();
const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
  expenditureId: string | null;
}>();

const emit = defineEmits<(e: 'update:modelValue', visible: boolean) => void>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const expenditureId = toRef(props, 'expenditureId');

const name = ref<string | null>(null);
const description = ref<string | null>(null);
const priceRaw = ref<number | null>(null);

const refFormEditExpenditure = ref<VForm>();

const { locale } = useI18n();

const getCurrencyConfig = () => {
  const localeMap: Record<string, { locale: string; currency: string }> = {
    pt: { locale: 'pt-BR', currency: 'BRL' },
    en: { locale: 'en-US', currency: 'USD' },
    es: { locale: 'es-ES', currency: 'EUR' },
  };

  return localeMap[locale.value] || localeMap.pt;
};

const formatCurrency = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return '';
  const config = getCurrencyConfig();
  return new Intl.NumberFormat(config.locale, {
    style: 'currency',
    currency: config.currency,
  }).format(value);
};

const removeInvalidChars = (value: string, allowedChars: string): string => {
  return value
    .split('')
    .filter((char) => {
      const code = char.codePointAt(0);
      return (
        (code !== undefined && code >= 48 && code <= 57) ||
        allowedChars.includes(char)
      );
    })
    .join('');
};

const parseCurrency = (value: string): number | null => {
  if (!value) return null;
  const config = getCurrencyConfig();
  let cleanValue = removeInvalidChars(value, '.,-');

  if (config.currency === 'BRL') {
    cleanValue = cleanValue.replaceAll('.', '');
    const commaIndex = cleanValue.indexOf(',');
    if (commaIndex !== -1) {
      cleanValue =
        cleanValue.substring(0, commaIndex) +
        '.' +
        cleanValue.substring(commaIndex + 1);
    }
  } else if (config.currency === 'USD' || config.currency === 'EUR') {
    cleanValue = cleanValue.replaceAll(',', '');
  }

  const parsed = Number.parseFloat(cleanValue);
  return Number.isNaN(parsed) ? null : parsed;
};

const priceDisplay = ref<string>('');

const price = computed({
  get: () => priceDisplay.value,
  set: (value: string) => {
    priceDisplay.value = value;
    priceRaw.value = parseCurrency(value);
  },
});

const handlePriceInput = (event: Event) => {
  const target = event.target as HTMLInputElement;
  let value = target.value;

  const config = getCurrencyConfig();

  if (config.currency === 'BRL') {
    value = removeInvalidChars(value, ',');
    const parts = value.split(',');
    if (parts.length > 2) {
      value = parts[0] + ',' + parts.slice(1).join('');
    }
    if (parts[1] && parts[1].length > 2) {
      value = parts[0] + ',' + parts[1].substring(0, 2);
    }
  } else {
    value = removeInvalidChars(value, '.');
    const parts = value.split('.');
    if (parts.length > 2) {
      value = parts[0] + '.' + parts.slice(1).join('');
    }
    if (parts[1] && parts[1].length > 2) {
      value = parts[0] + '.' + parts[1].substring(0, 2);
    }
  }

  priceDisplay.value = value;
  priceRaw.value = parseCurrency(value);
};

const handlePriceBlur = () => {
  if (priceRaw.value !== null) {
    priceDisplay.value = formatCurrency(priceRaw.value);
    return;
  }

  if (priceDisplay.value) {
    const parsed = parseCurrency(priceDisplay.value);
    if (parsed === null) {
      priceDisplay.value = '';
      priceRaw.value = null;
      return;
    }

    priceRaw.value = parsed;
    priceDisplay.value = formatCurrency(parsed);
  } else {
    priceDisplay.value = '';
  }
};

const updateExpenditure = async () => {
  const validateForm = await refFormEditExpenditure?.value?.validate();
  if (!validateForm?.valid) return;

  if (!expenditureId.value || !name.value || priceRaw.value === null) {
    return;
  }

  const payload: UpdateExpenditureRequest = {
    name: name.value,
    description: description.value,
    price: priceRaw.value,
  };

  const result = await expenditureStore.updateExpenditure(
    expenditureId.value,
    payload
  );
  if (result) {
    isVisible.value = false;
    await expenditureStore.listExpenditure();
  }
};

onMounted(async () => {
  if (!expenditureId.value) return;

  const expenditure = expenditureStore.list.find(
    (e) => e.expenditure_id === expenditureId.value
  );
  if (expenditure) {
    name.value = expenditure.name;
    description.value = expenditure.description;
    priceRaw.value = expenditure.price;
    priceDisplay.value = formatCurrency(expenditure.price);
  }
});
</script>

<template>
  <VDialog v-model="isVisible" max-width="600">
    <DialogCloseBtn @click="isVisible = false" />

    <template v-if="expenditureStore.loading">
      <VOverlay
        :model-value="expenditureStore.loading"
        class="align-center justify-center"
      >
        <VProgressCircular color="primary" indeterminate size="32" />
      </VOverlay>
    </template>

    <VForm ref="refFormEditExpenditure" @submit.prevent>
      <VCard :title="$t('edit_expenditure')">
        <VCardText>
          <VRow>
            <VCol cols="12">
              <AppTextField
                v-model="name"
                :label="$t('name') + ':'"
                :placeholder="$t('name')"
                :rules="[requiredValidator(name, $t('name_required'))]"
              />
            </VCol>
            <VCol cols="12">
              <AppTextarea
                v-model="description"
                :label="$t('description') + ':'"
                :placeholder="$t('description')"
                rows="3"
              />
            </VCol>
            <VCol cols="12">
              <AppTextField
                v-model="price"
                :label="$t('price') + ':'"
                :placeholder="formatCurrency(0)"
                :rules="[requiredValidator(priceRaw, $t('price_required'))]"
                @input="handlePriceInput"
                @blur="handlePriceBlur"
              />
            </VCol>
          </VRow>
        </VCardText>

        <VCardText class="d-flex justify-end flex-wrap gap-3">
          <VBtn variant="tonal" color="secondary" @click="isVisible = false">
            {{ $t('cancel') }}
          </VBtn>
          <VBtn @click="updateExpenditure"> {{ $t('save') }} </VBtn>
        </VCardText>
      </VCard>
    </VForm>
  </VDialog>
</template>

