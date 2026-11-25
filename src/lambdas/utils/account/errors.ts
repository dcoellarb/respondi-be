export class AccountError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    statusCode: number,
    code: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AccountError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function isAccountError(error: unknown): error is AccountError {
  if (error instanceof AccountError) return true;
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    name?: unknown;
    statusCode?: unknown;
    code?: unknown;
    message?: unknown;
  };
  return (
    candidate.name === "AccountError" &&
    typeof candidate.statusCode === "number" &&
    typeof candidate.code === "string" &&
    typeof candidate.message === "string"
  );
}

export function isConditionalFailure(error: unknown): boolean {
  return namedError(error) === "ConditionalCheckFailedException";
}

export function cancellationCodes(error: unknown): string[] | undefined {
  if (namedError(error) !== "TransactionCanceledException") return undefined;
  const reasons = (error as { CancellationReasons?: { Code?: string }[] })
    .CancellationReasons;
  return (reasons ?? []).map((reason) => reason.Code ?? "");
}

/** Map common DynamoDB client failures to AccountError; rethrow unknowns. */
export function rethrowAccountOrDynamo(error: unknown): never {
  if (isAccountError(error)) throw error;
  const name = namedError(error);
  const message = error instanceof Error ? error.message : "DynamoDB request failed";

  if (name === "ValidationException") {
    throw new AccountError(message, 400, "DYNAMO_VALIDATION");
  }
  if (name === "TransactionCanceledException") {
    const codes = cancellationCodes(error) ?? [];
    if (codes.some((code) => code === "ValidationError")) {
      throw new AccountError(message, 400, "DYNAMO_VALIDATION");
    }
  }
  throw error;
}

function namedError(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("name" in error)) return undefined;
  return String((error as { name: string }).name);
}
