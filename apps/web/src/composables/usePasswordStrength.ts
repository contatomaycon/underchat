import { computed, ref, watch } from 'vue';
import {
  calculatePasswordStrength,
  getPasswordStrengthColor,
  getPasswordStrengthLabel,
  EPasswordStrength,
  IPasswordStrength,
} from '@/@webcore/utils/passwordStrength';
import { useI18n } from 'vue-i18n';

export const usePasswordStrength = (password: () => string | null) => {
  const { t } = useI18n();
  const strength = ref<IPasswordStrength>({
    strength: EPasswordStrength.weak,
    score: 0,
    feedback: [],
  });

  const updateStrength = (pwd: string | null) => {
    if (!pwd) {
      strength.value = {
        strength: EPasswordStrength.weak,
        score: 0,
        feedback: [],
      };
      return;
    }

    strength.value = calculatePasswordStrength(pwd);
  };

  watch(
    () => password(),
    (newPassword) => {
      updateStrength(newPassword);
    },
    { immediate: true }
  );

  const strengthColor = computed(() =>
    getPasswordStrengthColor(strength.value.strength)
  );

  const strengthLabel = computed(() =>
    getPasswordStrengthLabel(strength.value.strength, t)
  );

  const strengthPercentage = computed(() => strength.value.score);

  return {
    strength: computed(() => strength.value),
    strengthColor,
    strengthLabel,
    strengthPercentage,
    updateStrength,
  };
};
