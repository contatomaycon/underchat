class InvalidConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidConfigurationError';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, InvalidConfigurationError);
    }
  }
}

export default InvalidConfigurationError;
