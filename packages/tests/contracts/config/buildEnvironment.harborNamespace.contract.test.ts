import { BuildEnvironment } from '@core/config/environments/BuildEnvironment';

describe('BuildEnvironment Harbor namespace', () => {
  const originalHarborNamespace = process.env.HARBOR_NAMESPACE;

  afterEach(() => {
    if (originalHarborNamespace === undefined) {
      delete process.env.HARBOR_NAMESPACE;
      return;
    }

    process.env.HARBOR_NAMESPACE = originalHarborNamespace;
  });

  it.each([
    ['double quotes', '"underchat/balance"'],
    ['single quotes', "'underchat/balance'"],
  ])(
    'unwraps one matching pair of %s preserved by docker --env-file',
    (_description, value) => {
      process.env.HARBOR_NAMESPACE = value;

      expect(new BuildEnvironment().harborNamespace).toBe('underchat/balance');
    }
  );

  it('keeps an unquoted namespace and trims its surrounding whitespace and slashes', () => {
    process.env.HARBOR_NAMESPACE = '  /underchat/balance/  ';

    expect(new BuildEnvironment().harborNamespace).toBe('underchat/balance');
  });

  it('removes only one matching outer quote pair', () => {
    process.env.HARBOR_NAMESPACE = '""underchat/balance""';

    expect(new BuildEnvironment().harborNamespace).toBe('"underchat/balance"');
  });

  it.each([undefined, '', '   ', '""', "''", '/', '///', '"/"', "'///'"])(
    'rejects an empty namespace after normalization: %p',
    (value) => {
      if (value === undefined) {
        delete process.env.HARBOR_NAMESPACE;
      } else {
        process.env.HARBOR_NAMESPACE = value;
      }

      expect(() => new BuildEnvironment().harborNamespace).toThrow(
        'HARBOR_NAMESPACE is not defined.'
      );
    }
  );
});
