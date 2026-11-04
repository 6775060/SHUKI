/** Explicit success/failure value, used across module boundaries instead of throwing. */
export type Result<T, E = AppError> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export type ErrorCode =
  | 'NETWORK'
  | 'TIMEOUT'
  | 'NOT_FOUND'
  | 'INVALID_INPUT'
  | 'FS_FORBIDDEN'
  | 'DUPLICATE'
  | 'NOT_APPROVED'
  | 'FIGMA_DISCONNECTED'
  | 'FIGMA_ERROR'
  | 'TEMPLATE_CHANGED'
  | 'FONT_MISSING'
  | 'VALIDATION_FAILED'
  | 'PARSE_FAILED'
  | 'INTERNAL';

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function toAppError(e: unknown, fallback: ErrorCode = 'INTERNAL'): AppError {
  if (e instanceof AppError) return e;
  if (e instanceof Error) return new AppError(fallback, e.message);
  return new AppError(fallback, String(e));
}
