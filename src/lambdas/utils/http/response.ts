import { APIGatewayProxyResult } from "aws-lambda";

export const standardHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

export function createSuccessResponse(
  data: unknown,
  statusCode = 200,
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: standardHeaders,
    body: JSON.stringify({ data }),
  };
}

export function createErrorResponse(
  error: string,
  statusCode = 500,
  additionalData?: Record<string, unknown>,
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: standardHeaders,
    body: JSON.stringify({
      error,
      ...additionalData,
    }),
  };
}
