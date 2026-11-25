import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { createErrorResponse } from "../http/response";

const FORBIDDEN_FIELDS = ["userId", "accountId", "email", "cognitoId"];

export interface AccountCaller {
  accountId: string;
  username: string;
}

export function rejectIdentityFields(
  raw: Record<string, unknown>,
): APIGatewayProxyResult | null {
  const fields = FORBIDDEN_FIELDS.filter((field) =>
    Object.prototype.hasOwnProperty.call(raw, field),
  );
  if (!fields.length) return null;
  return identityError(fields);
}

export function requireAccount(
  event: APIGatewayProxyEvent,
):
  | { ok: true; caller: AccountCaller }
  | { ok: false; response: APIGatewayProxyResult } {
  const pathFields = forbiddenKeys(event.pathParameters);
  if (pathFields.length) return { ok: false, response: identityError(pathFields) };

  const queryFields = forbiddenKeys(event.queryStringParameters);
  if (queryFields.length) return { ok: false, response: identityError(queryFields) };

  const claims = event.requestContext.authorizer?.claims as
    | Record<string, unknown>
    | undefined;
  const accountId = readClaim(claims, "sub");
  const username =
    readClaim(claims, "username") ?? readClaim(claims, "cognito:username");

  if (!accountId || !username || accountId.includes("#") || accountId.includes("/")) {
    return {
      ok: false,
      response: createErrorResponse(
        "Unauthorized - no valid authentication found",
        401,
        { code: "UNAUTHORIZED" },
      ),
    };
  }

  return { ok: true, caller: { accountId, username } };
}

function forbiddenKeys(
  source: Record<string, string | undefined> | null | undefined,
): string[] {
  if (!source) return [];
  return FORBIDDEN_FIELDS.filter((field) =>
    Object.prototype.hasOwnProperty.call(source, field),
  );
}

function identityError(fields: string[]): APIGatewayProxyResult {
  return createErrorResponse("Identity fields come from the access token", 400, {
    code: "IDENTITY_FIELD_NOT_ALLOWED",
    fields,
  });
}

function readClaim(
  claims: Record<string, unknown> | undefined,
  name: string,
): string | undefined {
  const value = claims?.[name];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}
