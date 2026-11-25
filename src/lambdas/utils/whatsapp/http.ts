import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";

const jsonHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

export function webhookReply(body: Record<string, unknown>): APIGatewayProxyResult {
  return {
    statusCode: 200,
    headers: jsonHeaders,
    body: JSON.stringify(body),
  };
}

export function webhookError(error: string, statusCode: number): APIGatewayProxyResult {
  return {
    statusCode,
    headers: jsonHeaders,
    body: JSON.stringify({ error }),
  };
}

export function challengeResponse(challenge: string): APIGatewayProxyResult {
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "text/plain",
      "Access-Control-Allow-Origin": "*",
    },
    body: challenge,
  };
}

export function rawBody(event: APIGatewayProxyEvent): string {
  if (!event.body) return "";
  if (event.isBase64Encoded) {
    return Buffer.from(event.body, "base64").toString("utf8");
  }
  return event.body;
}

export function headerValue(
  event: APIGatewayProxyEvent,
  name: string,
): string | undefined {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(event.headers ?? {})) {
    if (key.toLowerCase() === lower && typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}
