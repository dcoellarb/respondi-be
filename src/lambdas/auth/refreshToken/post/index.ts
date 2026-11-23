/**
 * @openapi
 * /auth/refresh:
 *   post:
 *     summary: Exchange a refresh token for new tokens
 *     tags:
 *       - Auth
 */
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { tokenResult } from "../../../utils/auth/cognitoProfile";
import { getErrorName } from "../../../utils/auth/errors";
import { readJsonObject } from "../../../utils/http/body";
import {
  createErrorResponse,
  createSuccessResponse,
} from "../../../utils/http/response";

const cognitoClient = new CognitoIdentityProviderClient({});

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  try {
    const body = readJsonObject(event);
    if (!body.ok) return body.response;

    const refreshToken = body.value.refreshToken;
    if (typeof refreshToken !== "string" || refreshToken.trim().length === 0) {
      return createErrorResponse("Refresh token is required", 400, {
        code: "MISSING_REQUIRED_FIELDS",
        missingFields: ["refreshToken"],
      });
    }

    const clientId = process.env.CLIENT_ID;
    if (!clientId) throw new Error("CLIENT_ID is not configured");

    const authResponse = await cognitoClient.send(
      new InitiateAuthCommand({
        AuthFlow: "REFRESH_TOKEN_AUTH",
        ClientId: clientId,
        AuthParameters: {
          REFRESH_TOKEN: refreshToken.trim(),
        },
      }),
    );

    return createSuccessResponse({
      message: "Token refreshed successfully",
      authResponse: tokenResult(authResponse),
    });
  } catch (error) {
    const name = getErrorName(error);
    if (name === "NotAuthorizedException") {
      return createErrorResponse("Refresh token is invalid or expired", 401, {
        code: "INVALID_REFRESH_TOKEN",
      });
    }
    console.error(error);
    return createErrorResponse("Failed to refresh token", 500, {
      code: "INTERNAL_ERROR",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
