export type NudgeErrorKind =
  | 'config'
  | 'auth'
  | 'cors'
  | 'rate_limit'
  | 'timeout'
  | 'context'
  | 'bad_request'
  | 'server'
  | 'cancelled'
  | 'empty'
  | 'storage'
  | 'unknown';

export class NudgeError extends Error {
  readonly kind: NudgeErrorKind;
  readonly status?: number;
  readonly detail?: string;
  readonly retryAfterMs?: number;
  readonly retryable: boolean;

  constructor(
    kind: NudgeErrorKind,
    message: string,
    options: { status?: number; detail?: string; retryAfterMs?: number; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = 'NudgeError';
    this.kind = kind;
    this.status = options.status;
    this.detail = options.detail;
    this.retryAfterMs = options.retryAfterMs;
    this.retryable = options.retryable ?? false;
  }
}

export function asNudgeError(error: unknown): NudgeError {
  if (error instanceof NudgeError) return error;
  if (error instanceof Error) {
    if (error.name === 'AbortError') {
      return new NudgeError('cancelled', 'The request was cancelled.');
    }
    return new NudgeError('unknown', error.message || 'Unexpected error.', { detail: error.message });
  }
  return new NudgeError('unknown', String(error));
}
