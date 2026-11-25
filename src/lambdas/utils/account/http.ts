import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { AccountCaller, rejectIdentityFields, requireAccount } from "../auth/requireAccount";
import { readJsonObject } from "../http/body";
import { createErrorResponse } from "../http/response";
import { isAccountError } from "./errors";
import { isEntityId } from "./keys";
import { FieldError } from "./types";

export function validationError(parsed: FieldError): APIGatewayProxyResult {
  return createErrorResponse(parsed.error, 400, {
    code: parsed.code,
    ...parsed.details,
  });
}

export function notFound(message: string, code: string): APIGatewayProxyResult {
  return createErrorResponse(message, 404, { code });
}

export function accountErrorResponse(error: unknown): APIGatewayProxyResult {
  if (isAccountError(error)) {
    const details =
      "details" in error && error.details && typeof error.details === "object"
        ? error.details
        : undefined;
    return createErrorResponse(error.message, error.statusCode, {
      code: error.code,
      ...details,
    });
  }
  console.error(error);
  return createErrorResponse("Internal error", 500, { code: "INTERNAL_ERROR" });
}

export async function handleAccount(
  event: APIGatewayProxyEvent,
  run: (caller: AccountCaller) => Promise<APIGatewayProxyResult>,
): Promise<APIGatewayProxyResult> {
  try {
    const auth = requireAccount(event);
    if (!auth.ok) return auth.response;
    return await run(auth.caller);
  } catch (error) {
    return accountErrorResponse(error);
  }
}

export function readAccountBody(
  event: APIGatewayProxyEvent,
):
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; response: APIGatewayProxyResult } {
  const body = readJsonObject(event);
  if (!body.ok) return body;
  const rejected = rejectIdentityFields(body.value);
  if (rejected) return { ok: false, response: rejected };
  return body;
}

export function pathEntityId(
  event: APIGatewayProxyEvent,
  name: string,
): { ok: true; value: string } | FieldError {
  const value = event.pathParameters?.[name];
  if (!value || !isEntityId(value)) {
    return { ok: false, error: `${name} is invalid`, code: "INVALID_ID" };
  }
  return { ok: true, value };
}
