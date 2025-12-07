<script lang="ts" setup>
import { usePlanStore } from '@/@webcore/stores/plan';
import { VForm } from 'vuetify/components/VForm';
import { UpdatePlanRequest } from '@core/schema/plan/updatePlan/request.schema';
import { EColor } from '@core/common/enums/EColor';

const planStore = usePlanStore();
const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
  planId: string | null;
}>();

const emit = defineEmits<(e: 'update:modelValue', visible: boolean) => void>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const planId = toRef(props, 'planId');

const name = ref<string | null>(null);
const priceRaw = ref<number | null>(null);
const price_oldRaw = ref<number | null>(null);
const description = ref<string | null>(null);
const annual_discount = ref<number | null>(null);
const icon = ref<string | null>(null);
const is_test = ref<boolean>(false);
const days_trial = ref<number | null>(null);

const refFormEditPlan = ref<VForm>();

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

const updatePlan = async () => {
  const validateForm = await refFormEditPlan?.value?.validate();
  if (!validateForm?.valid) return;

  if (!planId.value || !name.value || priceRaw.value === null) {
    return;
  }

  if (is_test.value && (!days_trial.value || days_trial.value < 1)) {
    planStore.showSnackbar(t('trial_days_required'), EColor.error);
    return;
  }

  const payload: UpdatePlanRequest = {
    name: name.value,
    price: priceRaw.value,
    price_old: price_oldRaw.value ?? 0,
    description: description.value ?? null,
    annual_discount: annual_discount.value ?? null,
    icon: icon.value ?? null,
    is_test: is_test.value,
    days_trial: is_test.value ? (days_trial.value ?? null) : null,
  };

  const result = await planStore.updatePlan(planId.value, payload);
  if (result) {
    isVisible.value = false;
    await planStore.listPlan();
  }
};

watch(is_test, (value) => {
  if (!value) {
    days_trial.value = null;
  }
});

onMounted(async () => {
  if (!planId.value) return;

  const plan = planStore.list.find((p) => p.plan_id === planId.value);
  if (plan) {
    name.value = plan.name;
    priceRaw.value = plan.price;
    price_oldRaw.value = plan.price_old;
    priceDisplay.value = formatCurrency(plan.price);
    price_oldDisplay.value = formatCurrency(plan.price_old);
    description.value = plan.description ?? null;
    annual_discount.value = plan.annual_discount
      ? Number.parseFloat(plan.annual_discount)
      : null;
    icon.value = plan.icon ?? null;
    is_test.value = plan.is_test ?? false;
    days_trial.value = plan.days_trial ?? null;
  }
});
</script>

<template>
  <VDialog v-model="isVisible" max-width="600">
    <DialogCloseBtn @click="isVisible = false" />

    <template v-if="planStore.loading">
      <VOverlay
        :model-value="planStore.loading"
        class="align-center justify-center"
      >
        <VProgressCircular color="primary" indeterminate size="32" />
      </VOverlay>
    </template>

    <VForm ref="refFormEditPlan" @submit.prevent>
      <VCard :title="$t('edit_plan')">
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
            <VCol cols="12" sm="6">
              <AppTextField
                v-model="price"
                :label="$t('price') + ':'"
                :placeholder="formatCurrency(0)"
                :rules="[requiredValidator(priceRaw, $t('price_required'))]"
                @input="handlePriceInput"
                @blur="handlePriceBlur"
              />
            </VCol>
            <VCol cols="12" sm="6">
              <AppTextField
                v-model="price_old"
                :label="$t('price_old') + ':'"
                :placeholder="formatCurrency(0)"
                @input="handlePriceOldInput"
                @blur="handlePriceOldBlur"
              />
            </VCol>
            <VCol cols="12">
              <AppTextarea
                v-model="description"
                :label="$t('description') + ':'"
                :placeholder="$t('description')"
                :maxlength="500"
                :counter="500"
                rows="3"
              />
            </VCol>
            <VCol cols="12" sm="6">
              <AppTextField
                v-model="annual_discount"
                type="number"
                :label="$t('annual_discount') + ' (%):'"
                :placeholder="'0'"
                :rules="[
                  (v: number | null) =>
                    !v || (v >= 0 && v <= 100) || $t('annual_discount_invalid'),
                ]"
              />
            </VCol>
            <VCol cols="12" sm="6">
              <AppTextField
                v-model="icon"
                :label="$t('icon') + ':'"
                :placeholder="$t('icon')"
                :maxlength="100"
              />
            </VCol>
            <VCol cols="12" sm="6">
              <AppSelect
                v-model="is_test"
                :items="[
                  { title: $t('no'), value: false },
                  { title: $t('yes'), value: true },
                ]"
                :label="$t('is_test_plan') + ':'"
                :placeholder="$t('is_test_plan')"
                item-title="title"
                item-value="value"
              />
            </VCol>
            <VCol v-if="is_test" cols="12" sm="6">
              <AppTextField
                v-model="days_trial"
                type="number"
                :label="$t('trial_days') + ':'"
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
          </VRow>
        </VCardText>

        <VCardText class="d-flex justify-end flex-wrap gap-3">
          <VBtn variant="tonal" color="secondary" @click="isVisible = false">
            {{ $t('cancel') }}
          </VBtn>
          <VBtn @click="updatePlan"> {{ $t('save') }} </VBtn>
        </VCardText>
      </VCard>
    </VForm>
  </VDialog>
</template>
