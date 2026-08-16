const PG_UNIQUE_VIOLATION = '23505';
const PG_SQLSTATE_PATTERN = /^[0-9]{2}[0-9A-Z]{3}$/;
const MAX_CAUSE_DEPTH = 8;

export interface PostgresErrorInfo {
  readonly code?: string;
  readonly constraintName?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readStringField(error: Record<string, unknown>, key: string): string | undefined {
  const value = error[key];
  return typeof value === 'string' ? value : undefined;
}

function readErrorInfo(error: Record<string, unknown>): PostgresErrorInfo | undefined {
  const code = readStringField(error, 'code');
  if (!code || !PG_SQLSTATE_PATTERN.test(code)) return undefined;
  const constraintName =
    readStringField(error, 'constraint_name') ?? readStringField(error, 'constraint');
  return constraintName === undefined ? { code } : { code, constraintName };
}

export function inspectPostgresError(error: unknown): PostgresErrorInfo {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (!isRecord(current)) return {};
    const info = readErrorInfo(current);
    if (info) return info;
    current = current.cause;
  }
  return {};
}

export function isPostgresUniqueViolation(error: unknown): boolean {
  return inspectPostgresError(error).code === PG_UNIQUE_VIOLATION;
}

export function isPostgresUniqueViolationOn(error: unknown, constraintName: string): boolean {
  const info = inspectPostgresError(error);
  return info.code === PG_UNIQUE_VIOLATION && info.constraintName === constraintName;
}
