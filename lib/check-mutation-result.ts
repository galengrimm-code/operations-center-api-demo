// lib/check-mutation-result.ts

export class MutationError extends Error {
  constructor(
    message: string,
    public operation: string,
  ) {
    super(message);
    this.name = "MutationError";
  }
}

export function checkMutationResult<T>(
  data: T | T[] | null,
  operation: string,
  expected = 1,
): T | T[] {
  const count = Array.isArray(data) ? data.length : data ? 1 : 0;
  if (count < expected) {
    throw new MutationError(
      `${operation} failed: expected ${expected} row(s) affected, got ${count}. This may indicate a permissions issue.`,
      operation,
    );
  }
  return data as T | T[];
}
