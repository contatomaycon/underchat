<script lang="ts" setup>
import { useServerStore } from '@/@webcore/stores/server';
import { CreateServerRequest } from '@core/schema/server/createServer/request.schema';
import { VForm } from 'vuetify/components/VForm';

const serverStore = useServerStore();

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', visible: boolean): void;
}>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const name = ref<string | null>(null);
const ip = ref<string | null>(null);
const port = ref<number | null>(null);
const username = ref<string | null>(null);
const password = ref<string | null>(null);

const refFormAddServer = ref<VForm>();

const addServer = async () => {
  const validateForm = await refFormAddServer?.value?.validate();
  if (!validateForm?.valid) return;

  if (
    !name.value ||
    !ip.value ||
    !port.value ||
    !username.value ||
    !password.value
  ) {
    return;
  }

  const payload: CreateServerRequest = {
    name: name.value,
    ssh_ip: ip.value,
    ssh_port: port.value,
    ssh_username: username.value,
    ssh_password: password.value,
  };

  const result = await serverStore.addServer(payload);

  if (result) {
    isVisible.value = false;

    await serverStore.listServers();
  }
};
</script>

<template>
  <VDialog v-model="isVisible" max-width="600">
    <DialogCloseBtn @click="isVisible = false" />

    <template v-if="serverStore.loading">
      <VOverlay
        :model-value="serverStore.loading"
        class="align-center justify-center"
      >
        <VProgressCircular color="primary" indeterminate size="32" />
      </VOverlay>
    </template>

    <VForm ref="refFormAddServer" @submit.prevent>
      <VCard :title="$t('add_server')">
        <VCardText>
          <VRow>
            <VCol cols="12">
              <AppTextField
                v-model="name"
                :label="$t('name') + ':'"
                :placeholder="$t('name_server')"
                :rules="[requiredValidator(name, $t('name_required'))]"
              />
            </VCol>

            <VCol cols="12" sm="6" md="6">
              <AppTextField
                v-model="ip"
                :label="$t('ip') + ':'"
                :placeholder="$t('ip')"
                :rules="[
                  requiredValidator(ip, $t('ip_required')),
                  isValidIP(ip, $t('ip_invalid')),
                ]"
                v-maska="ipMask"
              />
            </VCol>

            <VCol cols="12" sm="6" md="6">
              <AppTextField
                v-model="port"
                :label="$t('port') + ':'"
                :placeholder="$t('port')"
                :rules="[requiredValidator(port, $t('port_required'))]"
                type="number"
              />
            </VCol>

            <VCol cols="12" sm="6" md="6">
              <AppTextField
                v-model="username"
                :label="$t('username') + ':'"
                :placeholder="$t('username')"
                :rules="[requiredValidator(username, $t('username_required'))]"
              />
            </VCol>

            <VCol cols="12" sm="6" md="6">
              <AppTextField
                v-model="password"
                :label="$t('password') + ':'"
                :placeholder="$t('password')"
                :rules="[requiredValidator(password, $t('password_required'))]"
              />
            </VCol>
          </VRow>
        </VCardText>

        <VCardText class="d-flex justify-end flex-wrap gap-3">
          <VBtn variant="tonal" color="secondary" @click="isVisible = false">
            {{ $t('cancel') }}
          </VBtn>
          <VBtn @click="addServer"> {{ $t('add') }} </VBtn>
        </VCardText>
      </VCard>
    </VForm>
  </VDialog>
</template>
