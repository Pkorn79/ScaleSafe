export class ProcessorError extends Error {
  constructor(
    message: string,
    public readonly processor: 'nmi' | 'stripe',
    public readonly code?: string,
    public readonly isRetryable: boolean = false,
    public readonly rawError?: any,
  ) {
    super(message);
    this.name = 'ProcessorError';
  }
}
