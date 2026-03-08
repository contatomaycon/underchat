import { describe, expect, it } from '@jest/globals';
import {
  formatDateInputDisplay,
  normalizeBirthdayIso,
  normalizeDateDisplay,
} from '../utils/date';

describe('date utils', () => {
  describe('formatDateInputDisplay', () => {
    it('aplica máscara DD/MM/YYYY enquanto digita', () => {
      expect(formatDateInputDisplay('1')).toBe('1');
      expect(formatDateInputDisplay('1203')).toBe('12/03');
      expect(formatDateInputDisplay('12031995')).toBe('12/03/1995');
    });

    it('remove caracteres inválidos e limita 8 dígitos', () => {
      expect(formatDateInputDisplay('12a03b1995xx')).toBe('12/03/1995');
      expect(formatDateInputDisplay('12031995123')).toBe('12/03/1995');
    });
  });

  describe('normalizeBirthdayIso', () => {
    it('normaliza DD/MM/YYYY para YYYY-MM-DD', () => {
      expect(normalizeBirthdayIso('07/03/2026')).toBe('2026-03-07');
    });

    it('mantém YYYY-MM-DD válido', () => {
      expect(normalizeBirthdayIso('2026-03-07')).toBe('2026-03-07');
    });

    it('retorna null para datas inválidas', () => {
      expect(normalizeBirthdayIso('31/02/2026')).toBeNull();
      expect(normalizeBirthdayIso('2026-13-10')).toBeNull();
      expect(normalizeBirthdayIso('')).toBeNull();
    });
  });

  describe('normalizeDateDisplay', () => {
    it('converte ISO para DD/MM/YYYY', () => {
      expect(normalizeDateDisplay('2026-03-07')).toBe('07/03/2026');
    });

    it('aceita DD/MM/YYYY válido e devolve no mesmo padrão', () => {
      expect(normalizeDateDisplay('07/03/2026')).toBe('07/03/2026');
    });

    it('retorna null para inválidos', () => {
      expect(normalizeDateDisplay('32/01/2026')).toBeNull();
    });
  });
});
