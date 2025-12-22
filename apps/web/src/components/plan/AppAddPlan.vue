<script lang="ts" setup>
import { usePlanStore } from '@/@webcore/stores/plan';
import { VForm } from 'vuetify/components/VForm';
import { CreatePlanRequest } from '@core/schema/plan/createPlan/request.schema';
import { EColor } from '@core/common/enums/EColor';
import { EPlanStatus } from '@core/common/enums/EPlanStatus';

const planStore = usePlanStore();
const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<(e: 'update:modelValue', visible: boolean) => void>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const name = ref<string | null>(null);
const priceRaw = ref<number | null>(null);
const price_oldRaw = ref<number | null>(null);
const description = ref<string | null>(null);
const annual_discount = ref<number | null>(null);
const icon = ref<string | null>(null);
const is_test = ref<boolean>(false);
const days_trial = ref<number | null>(null);
const is_exclusive = ref<boolean>(false);
const status = ref<EPlanStatus>(EPlanStatus.active);

const testOptions = computed(() => [
  { title: t('no'), value: false },
  { title: t('yes'), value: true },
]);

const exclusiveOptions = computed(() => [
  { title: t('no'), value: false },
  { title: t('yes'), value: true },
]);

const statusOptions = computed(() => [
  { title: t('active'), value: EPlanStatus.active },
  { title: t('inactive'), value: EPlanStatus.inactive },
]);

const refFormAddPlan = ref<VForm>();

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
const price_oldDisplay = ref<string>('');

const price = computed({
  get: () => priceDisplay.value,
  set: (value: string) => {
    priceDisplay.value = value;
    priceRaw.value = parseCurrency(value);
  },
});

const price_old = computed({
  get: () => price_oldDisplay.value,
  set: (value: string) => {
    price_oldDisplay.value = value;
    price_oldRaw.value = parseCurrency(value);
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

const handlePriceOldInput = (event: Event) => {
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

  price_oldDisplay.value = value;
  price_oldRaw.value = parseCurrency(value);
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

const handlePriceOldBlur = () => {
  if (price_oldRaw.value !== null) {
    price_oldDisplay.value = formatCurrency(price_oldRaw.value);
    return;
  }

  if (price_oldDisplay.value) {
    const parsed = parseCurrency(price_oldDisplay.value);
    if (parsed === null) {
      price_oldDisplay.value = '';
      price_oldRaw.value = null;
      return;
    }

    price_oldRaw.value = parsed;
    price_oldDisplay.value = formatCurrency(parsed);
  } else {
    price_oldDisplay.value = '';
  }
};

const addPlan = async () => {
  const validateForm = await refFormAddPlan?.value?.validate();
  if (!validateForm?.valid) return;

  if (!name.value || priceRaw.value === null) {
    return;
  }

  if (is_test.value && (!days_trial.value || days_trial.value < 1)) {
    planStore.showSnackbar(t('trial_days_required'), EColor.error);
    return;
  }

  const payload: CreatePlanRequest = {
    name: name.value,
    price: priceRaw.value,
    price_old: price_oldRaw.value ?? 0,
    description: description.value ?? undefined,
    annual_discount: annual_discount.value ?? undefined,
    icon: icon.value ?? undefined,
    is_test: is_test.value || undefined,
    days_trial: is_test.value ? (days_trial.value ?? undefined) : undefined,
    is_exclusive: is_exclusive.value,
    status: status.value,
  };

  const result = await planStore.createPlan(payload);
  if (result) {
    isVisible.value = false;
    await planStore.listPlan();
  }
};

const resetForm = () => {
  name.value = null;
  priceRaw.value = null;
  price_oldRaw.value = null;
  priceDisplay.value = '';
  price_oldDisplay.value = '';
  description.value = null;
  annual_discount.value = null;
  icon.value = null;
  is_test.value = false;
  days_trial.value = null;
  is_exclusive.value = false;
  status.value = EPlanStatus.active;
  refFormAddPlan.value?.resetValidation();
};

watch(isVisible, (visible) => {
  if (visible) resetForm();
});

watch(is_test, (value) => {
  if (!value) {
    days_trial.value = null;
  }
});

onMounted(resetForm);
</script>

<template>
  <VDialog v-model="isVisible" max-width="600">
    <DialogCloseBtn @click="isVisible = false" />

    <VOverlay
      :model-value="planStore.loading"
      class="align-center justify-center"
      contained
    >
      <VProgressCircular color="primary" indeterminate size="64" />
    </VOverlay>

    <VForm ref="refFormAddPlan" @submit.prevent>
      <VCard :title="$t('add_plan')">
        <VCardText>
          <VRow>
            <VCol cols="12">
              <VLabel class="text-body-2 mb-1">{{ $t('name') }}:</VLabel>
              <AppTextField
                v-model="name"
                :placeholder="$t('name')"
                :rules="[requiredValidator(name, $t('name_required'))]"
              />
            </VCol>
            <VCol cols="12" sm="6">
              <VLabel class="text-body-2 mb-1">{{ $t('price') }}:</VLabel>
              <AppTextField
                v-model="price"
                :placeholder="formatCurrency(0)"
                :rules="[requiredValidator(priceRaw, $t('price_required'))]"
                @input="handlePriceInput"
                @blur="handlePriceBlur"
              />
            </VCol>
            <VCol cols="12" sm="6">
              <VLabel class="text-body-2 mb-1">{{ $t('price_old') }}:</VLabel>
              <AppTextField
                v-model="price_old"
                :placeholder="formatCurrency(0)"
                @input="handlePriceOldInput"
                @blur="handlePriceOldBlur"
              />
            </VCol>
            <VCol cols="12">
              <VLabel class="text-body-2 mb-1">{{ $t('description') }}:</VLabel>
              <AppTextarea
                v-model="description"
                :placeholder="$t('description')"
                :maxlength="500"
                :counter="500"
                rows="3"
              />
            </VCol>
            <VCol cols="12" sm="6">
              <VLabel class="text-body-2 mb-1"
                >{{ $t('annual_discount') }} (%):</VLabel
              >
              <AppTextField
                v-model="annual_discount"
                type="number"
                :placeholder="'0'"
                :rules="[
                  (v: number | null) =>
                    !v || (v >= 0 && v <= 100) || $t('annual_discount_invalid'),
                ]"
              />
            </VCol>
            <VCol cols="12" sm="6">
              <VLabel class="text-body-2 mb-1">{{ $t('icon') }}:</VLabel>
              <AppTextField
                v-model="icon"
                :placeholder="$t('icon')"
                :maxlength="100"
              />
            </VCol>
            <VCol cols="12" sm="6">
              <VLabel class="text-body-2 mb-1"
                >{{ $t('is_test_plan') }}:</VLabel
              >
              <AppSelectSearch
                v-model="is_test"
                :items="testOptions"
                :placeholder="$t('is_test_plan')"
                :clearable="true"
                item-value="value"
                item-title="title"
              />
            </VCol>
            <VCol v-if="is_test" cols="12" sm="6">
              <VLabel class="text-body-2 mb-1">{{ $t('trial_days') }}:</VLabel>
              <AppTextField
                v-model="days_trial"
                type="number"
                :placeholder="$t('trial_days')"
                :rules="[
                  (v: number | null) =>
                    !is_test ||
                    (v !== null && v >= 1) ||
                    $t('trial_days_required'),
                ]"
                :min="1"
              />
            </VCol>
            <VCol cols="12" sm="6">
              <VLabel class="text-body-2 mb-1"
                >{{ $t('is_exclusive_plan') }}:</VLabel
              >
              <AppSelectSearch
                v-model="is_exclusive"
                :items="exclusiveOptions"
                :placeholder="$t('is_exclusive_plan')"
                :clearable="true"
                item-value="value"
                item-title="title"
              />
            </VCol>
            <VCol cols="12" sm="6">
              <VLabel class="text-body-2 mb-1">{{ $t('status') }}:</VLabel>
              <AppSelectSearch
                v-model="status"
                :items="statusOptions"
                :placeholder="$t('status')"
                :clearable="true"
                item-value="value"
                item-title="title"
              />
            </VCol>
          </VRow>
        </VCardText>

        <VCardText class="d-flex justify-end flex-wrap gap-3">
          <VBtn variant="tonal" color="secondary" @click="isVisible = false">
            {{ $t('cancel') }}
          </VBtn>
          <VBtn @click="addPlan"> {{ $t('add') }} </VBtn>
        </VCardText>
      </VCard>
    </VForm>
  </VDialog>
</template>
