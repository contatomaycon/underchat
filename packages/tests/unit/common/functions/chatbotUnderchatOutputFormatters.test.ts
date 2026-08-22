import {
  createChatbotUnderchatVariableOutput,
  formatChatbotUnderchatAmount,
  formatChatbotUnderchatBillingPeriod,
  formatChatbotUnderchatDateTime,
  formatChatbotUnderchatDocument,
  formatChatbotUnderchatPhone,
  formatChatbotUnderchatStatus,
} from '@core/common/functions/chatbotUnderchatOutputFormatters';
import { createEmptyChatbotUnderchatLookupOutput } from '@core/common/interfaces/IChatbotUnderchatLookup';

describe('chatbot Underchat output formatters', () => {
  it('translates canonical statuses and billing periods to pt-BR', () => {
    expect(formatChatbotUnderchatStatus('active')).toBe('Ativo');
    expect(formatChatbotUnderchatStatus('inactive')).toBe('Inativo');
    expect(formatChatbotUnderchatStatus('blocked')).toBe('Bloqueado');
    expect(formatChatbotUnderchatBillingPeriod('monthly')).toBe('Mensal');
    expect(formatChatbotUnderchatBillingPeriod('annual')).toBe('Anual');
  });

  it('formats CPF, numeric CNPJ and alphanumeric CNPJ', () => {
    expect(formatChatbotUnderchatDocument('03071321104')).toBe(
      '030.713.211-04'
    );
    expect(formatChatbotUnderchatDocument('04252011000110')).toBe(
      '04.252.011/0001-10'
    );
    expect(formatChatbotUnderchatDocument('12abc34501de35')).toBe(
      '12.ABC.345/01DE-35'
    );
  });

  it('formats phones with and without the Brazilian country code', () => {
    expect(formatChatbotUnderchatPhone('+5511999999999')).toBe(
      '+55 (11) 99999-9999'
    );
    expect(formatChatbotUnderchatPhone('11999999999')).toBe('(11) 99999-9999');
  });

  it('formats dates in the application timezone and amounts with decimal comma', () => {
    expect(formatChatbotUnderchatDateTime('2026-02-19T03:10:40.465Z')).toBe(
      '19/02/2026 às 00:10'
    );
    expect(formatChatbotUnderchatAmount(106.39)).toBe('106,39');
    expect(formatChatbotUnderchatAmount('106,39')).toBe('106,39');
  });

  it('keeps unknown labels and already formatted values stable', () => {
    expect(formatChatbotUnderchatStatus('custom')).toBe('custom');
    expect(formatChatbotUnderchatDateTime('19/02/2026 às 00:10')).toBe(
      '19/02/2026 às 00:10'
    );
    expect(formatChatbotUnderchatDocument('030.713.211-04')).toBe(
      '030.713.211-04'
    );
  });

  it('projects only formatted public variables and keeps found internal', () => {
    const empty = createEmptyChatbotUnderchatLookupOutput();
    const variables = createChatbotUnderchatVariableOutput({
      ...empty,
      found: true,
      user: { ...empty.user, status: 'active' },
      account: {
        ...empty.account,
        billing_period: 'annual',
        last_paid_amount: 1234.5,
      },
    });

    expect(variables).not.toHaveProperty('found');
    expect(variables).toMatchObject({
      user: { status: 'Ativo' },
      account: {
        billing_period: 'Anual',
        last_paid_amount: '1.234,50',
      },
    });
  });
});
