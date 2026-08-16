export type AiErrorCode =
  | 'AI_DISABLED'
  | 'AI_PROVIDER_UNAVAILABLE'
  | 'AI_PROVIDER_ERROR'
  | 'AI_TIMEOUT'
  | 'AI_RATE_LIMITED'
  | 'AI_INVALID_TOOL_CALL'
  | 'AI_UNSAFE_PROPOSAL'
  | 'AI_STALE_PROPOSAL'
  | 'AI_CONTEXT_LIMIT'
  | 'AI_RESPONSE_INVALID';

const HTTP_STATUS_BY_CODE: Partial<Record<AiErrorCode, number>> = {
  AI_DISABLED: 503,
  AI_PROVIDER_UNAVAILABLE: 503,
  AI_PROVIDER_ERROR: 502,
  AI_TIMEOUT: 504,
  AI_RATE_LIMITED: 429,
  AI_INVALID_TOOL_CALL: 400,
  AI_UNSAFE_PROPOSAL: 400,
  AI_STALE_PROPOSAL: 409,
  AI_CONTEXT_LIMIT: 413,
  AI_RESPONSE_INVALID: 502,
};

/**
 * Stable, safe error for the advisor boundary. Messages are deliberately
 * generic and never include raw provider exceptions, financial data, or
 * conversation contents.
 */
export class AiError extends Error {
  readonly code: AiErrorCode;
  readonly status: number;

  constructor(code: AiErrorCode, message = 'The AI advisor could not complete the request.') {
    super(message);
    this.name = 'AiError';
    this.code = code;
    this.status = HTTP_STATUS_BY_CODE[code] ?? 500;
  }

  toJSON() {
    return { code: this.code, message: this.message };
  }
}

export function isAiError(value: unknown): value is AiError {
  return value instanceof AiError;
}
