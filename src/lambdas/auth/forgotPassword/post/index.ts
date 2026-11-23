/**
 * @openapi
 * /auth/forgot-password:
 *   post:
 *     summary: Send a password reset code
 *     description: Google accounts are rejected so a reset code cannot replace Google sign-in. Unknown emails get the same success message.
 *     tags:
 *       - Auth
 */
import {
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
  ForgotPasswordCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { attributeValue, normalizeEmail } from "../../../utils/auth/cognitoProfile";
import { getErrorName } from "../../../utils/auth/errors";
import { readJsonObject } from "../../../utils/http/body";
import {
  createErrorResponse,
  createSuccessResponse,
} from "../../../utils/http/response";

const cognitoClient = new CognitoIdentityProviderClient({});

const GENERIC_SUCCESS_MESSAGE =
  "If an account exists for this email, a reset code has been sent.";

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  try {
    const clientId = process.env.CLIENT_ID;
    const userPoolId = process.env.USER_POOL_ID;
    if (!clientId || !userPoolId) {
      throw new Error("Cognito is not configured");
    }

    const body = readJsonObject(event);
    if (!body.ok) return body.response;

    const emailRaw = body.value.email;
    if (typeof emailRaw !== "string" || emailRaw.trim().length === 0) {
      return createErrorResponse("Missing or empty required fields", 400, {
        code: "MISSING_REQUIRED_FIELDS",
        missingFields: ["email"],
      });
    }
    const email = normalizeEmail(emailRaw);

    try {
      const existing = await cognitoClient.send(
        new AdminGetUserCommand({
          UserPoolId: userPoolId,
          Username: email,
        }),
      );
      if (attributeValue(existing.UserAttributes, "custom:authProvider") === "google") {
        return createErrorResponse(
          "Password reset is not available for this account. Sign in with Google.",
          400,
          { code: "FORGOT_PASSWORD_NOT_ALLOWED" },
        );
      }
    } catch (error) {
      if (getErrorName(error) === "UserNotFoundException") {
        return createSuccessResponse({ message: GENERIC_SUCCESS_MESSAGE });
      }
      throw error;
    }

    try {
      await cognitoClient.send(
        new ForgotPasswordCommand({
          ClientId: clientId,
          Username: email,
        }),
      );
    } catch (error) {
      const name = getErrorName(error);
      if (name === "UserNotFoundException") {
        return createSuccessResponse({ message: GENERIC_SUCCESS_MESSAGE });
      }
      if (name === "LimitExceededException" || name === "TooManyRequestsException") {
        return createErrorResponse("Too many attempts. Please try again later.", 429, {
          code: "RATE_LIMIT_EXCEEDED",
        });
      }
      if (name === "InvalidParameterException" || name === "NotAuthorizedException") {
        return createErrorResponse("Password reset is not available for this account.", 400, {
          code: "FORGOT_PASSWORD_NOT_ALLOWED",
        });
      }
      throw error;
    }

    return createSuccessResponse({ message: GENERIC_SUCCESS_MESSAGE });
  } catch (error) {
    console.error(error);
    return createErrorResponse("Failed to request password reset", 500, {
      code: "INTERNAL_ERROR",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
