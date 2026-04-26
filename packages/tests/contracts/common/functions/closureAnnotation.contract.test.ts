import {
  isLegacyClosureAuditMessage,
  resolveClosureAnnotationKind,
} from '@core/common/functions/closureAnnotation';

describe('closureAnnotation', () => {
  it('classifies closure as reason when message is not a legacy audit text', () => {
    expect(
      resolveClosureAnnotationKind('closure', 'Cliente solicitou encerramento.')
    ).toBe('reason');
  });

  it('classifies closure_audit subtype as audit', () => {
    expect(
      resolveClosureAnnotationKind(
        'closure_audit',
        'Atendimento finalizado pelo operador *Maycon*.'
      )
    ).toBe('audit');
  });

  it('classifies legacy closure subtype with audit content as audit', () => {
    expect(
      resolveClosureAnnotationKind(
        'closure',
        'Atendimento finalizado pelo operador Maycon.'
      )
    ).toBe('audit');

    expect(
      resolveClosureAnnotationKind(
        'closure',
        'Attendance finished due to inactivity.'
      )
    ).toBe('audit');
  });

  it('detects legacy audit text in multiple locales', () => {
    expect(
      isLegacyClosureAuditMessage(
        'Atención finalizada por el operador *María*.'
      )
    ).toBe(true);
    expect(
      isLegacyClosureAuditMessage('Atención finalizada por inactividad.')
    ).toBe(true);
    expect(isLegacyClosureAuditMessage('Motivo: cliente pediu encerramento.')).toBe(
      false
    );
  });

  it('returns null when subtype is not closure-related', () => {
    expect(resolveClosureAnnotationKind(null, 'Atendimento finalizado.')).toBe(
      null
    );
  });
});
