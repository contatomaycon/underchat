<script lang="ts" setup>
import { VForm } from 'vuetify/components/VForm';
import { useLabelTemplateStore } from '@/@webcore/stores/labelTemplate';
import { useContactStore } from '@/@webcore/stores/contact';
import {
  EditContactParamsRequest,
  UpdateContactRequest,
} from '@core/schema/contact/editContact/request.schema';

const contactStore = useContactStore();
const labelTemplateStore = useLabelTemplateStore();

const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
  contactId: string | null;
}>();

function formatPhone(e: Event) {
  const input = e.target as HTMLInputElement;
  let value = input.value.replaceAll(/\D/g, '').slice(0, 9);

  if (value.length > 4 && value.length <= 8) {
    value = `${value.slice(0, -4)}-${value.slice(-4)}`;
  } else if (value.length > 8) {
    value = `${value.slice(0, 5)}-${value.slice(5)}`;
  }

  input.value = value;
}

const emailValidator = (v: string | null | undefined) => {
  const s = (v ?? '').trim();
  if (!s) return true;
  const re = /^[^\s@]+@(?:[^\s@.]+\.)+[^\s@.]{2,}$/;
  return re.test(s) || t('email_invalid');
};

const itemsLabel = computed(() =>
  (labelTemplateStore.listAll ?? []).map((item) => ({
    value: item.label_template_id,
    title: item.label,
  }))
);

const emit = defineEmits<(e: 'update:modelValue', visible: boolean) => void>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const contactId = toRef(props, 'contactId');

const label_template_id = ref<string | null>(null);
const name = ref<string | null>(null);
const last_name = ref<string | null>(null);
const email = ref<string | null>(null);
const phone_ddi = ref<string | null>(null);
const phone = ref<string | null>(null);
const nickname = ref<string | null>(null);
const birthday = ref<string | null>(null);
const notes = ref<string | null>(null);

const refFormEditContact = ref<VForm>();

const updateContact = async () => {
  const validateForm = await refFormEditContact?.value?.validate();
  if (!validateForm?.valid) return;

  if (
    !contactId.value ||
    !label_template_id.value ||
    !name.value ||
    !last_name.value ||
    !email.value ||
    !phone.value ||
    !nickname.value ||
    !birthday.value ||
    !notes.value ||
    !phone_ddi.value
  ) {
    return;
  }

  const payload: EditContactParamsRequest = {
    contact_id: contactId.value,
  };

  const body: UpdateContactRequest = {
    label_template_id: label_template_id.value,
    name: name.value,
    last_name: last_name.value,
    email: email.value,
    phone_ddi: phone_ddi.value,
    phone: phone.value,
    nickname: nickname.value,
    birthday: birthday.value,
    notes: notes.value,
  };

  const result = await contactStore.updateContact(payload, body);

  if (result) {
    isVisible.value = false;

    await contactStore.listContact();
  }
};

onMounted(async () => {
  if (!contactId.value) return;

  const contact = await contactStore.getContactById(contactId.value);
  if (contact) {
    label_template_id.value = contact.label_template?.label_template_id ?? null;
    name.value = contact.name;
    last_name.value = contact.last_name ?? null;
    email.value = contact.email_partial ?? null;
    phone_ddi.value = contact.phone_ddi ?? null;
    phone.value = contact.phone_partial ?? null;
    nickname.value = contact.nickname ?? null;
    birthday.value = contact.birthday ?? null;
    notes.value = contact.notes ?? null;
  }
  await labelTemplateStore.listLabelTemplateAll();
});
</script>

<template>
  <VDialog v-model="isVisible" max-width="600">
    <DialogCloseBtn @click="isVisible = false" />

    <template v-if="contactStore.loading">
      <VOverlay
        :model-value="contactStore.loading"
        class="align-center justify-center"
      >
        <VProgressCircular color="primary" indeterminate size="32" />
      </VOverlay>
    </template>

    <VForm ref="refFormEditContact" @submit.prevent>
      <VCard :title="$t('edit_contact')">
        <VCardText>
          <VRow>
            <VCol cols="12" md="6">
              <AppTextField
                v-model="name"
                :label="$t('name') + ':'"
                :placeholder="$t('name')"
                :rules="[requiredValidator(name, $t('name_required'))]"
              />
            </VCol>

            <VCol cols="12" md="6">
              <AppTextField
                v-model="last_name"
                :label="$t('last_name') + ':'"
                :placeholder="$t('last_name')"
              />
            </VCol>
          </VRow>
          <VRow>
            <VCol cols="12" md="6">
              <AppTextField
                v-model="nickname"
                :label="$t('nickname') + ':'"
                :placeholder="$t('nickname')"
              />
            </VCol>

            <VCol cols="12" md="6">
              <AppTextField
                v-model="email"
                type="email"
                :label="$t('email') + ':'"
                :placeholder="$t('email')"
                :rules="[emailValidator]"
              />
            </VCol>
          </VRow>
          <VRow>
            <VCol cols="12" md="6">
              <AppTextField
                v-model="phone_ddi"
                type="tel"
                :label="$t('phone_ddi') + ':'"
                :placeholder="$t('phone_ddi')"
                maxlength="2"
                @input="
                  phone_ddi = phone_ddi
                    ? phone_ddi.replaceAll(/\D/g, '').slice(0, 2)
                    : null
                "
              />
            </VCol>

            <VCol cols="12" md="6">
              <AppTextField
                v-model="phone"
                type="tel"
                :label="$t('phone') + ':'"
                :placeholder="$t('phone')"
                @input="formatPhone"
              />
            </VCol>
          </VRow>
          <VRow>
            <VCol cols="12" md="6">
              <AppDateTimePicker
                v-model="birthday"
                :label="$t('birthday') + ':'"
                :placeholder="$t('birthday')"
              />
            </VCol>

            <VCol cols="12" md="6">
              <AppSelect
                v-model="label_template_id"
                :items="itemsLabel"
                item-title="title"
                item-value="value"
                :label="$t('label') + ':'"
                :placeholder="$t('select_label')"
              />
            </VCol>
          </VRow>
          <VRow>
            <VCol cols="12">
              <label class="text-body-2 mb-1" for="notes-textarea">
                {{ $t('notes') }}:
              </label>
              <VTextarea v-model="notes" :placeholder="$t('notes')" />
            </VCol>
          </VRow>
        </VCardText>

        <VCardText class="d-flex justify-end flex-wrap gap-3">
          <VBtn variant="tonal" color="secondary" @click="isVisible = false">
            {{ $t('cancel') }}
          </VBtn>
          <VBtn @click="updateContact"> {{ $t('save') }} </VBtn>
        </VCardText>
      </VCard>
    </VForm>
  </VDialog>
</template>
