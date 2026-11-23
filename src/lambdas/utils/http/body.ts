import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { createErrorResponse } from "./response";

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function readJsonObject(
  event: APIGatewayProxyEvent,
):
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; response: APIGatewayProxyResult } {
  if (!event.body) {
    return {
      ok: false,
      response: createErrorResponse("Request body is required", 400, {
        code: "MISSING_BODY",
      }),
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(event.body);
  } catch {
    return {
      ok: false,
      response: createErrorResponse("Invalid JSON in request body", 400, {
        code: "INVALID_JSON",
      }),
    };
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      response: createErrorResponse("Request body must be a JSON object", 400, {
        code: "INVALID_BODY",
      }),
    };
  }

  return { ok: true, value: parsed as Record<string, unknown> };
}

export function missingFields(
  raw: Record<string, unknown>,
  names: string[],
): string[] {
  return names.filter((name) => !isNonEmptyString(raw[name]));
}
