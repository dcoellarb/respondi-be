/**
 * @openapi
 * /auth/confirm-forgot-password:
 *   post:
 *     operationId: confirmForgotPassword
 *     summary: Set a new password with the emailed code
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, confirmationCode, newPassword]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               confirmationCode:
 *                 type: string
 *               newPassword:
 *                 type: string
 *     responses:
 *       "200":
 *         description: Password updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/Message"
 *       "400":
 *         $ref: "#/components/responses/BadRequest"
 *       "429":
 *         $ref: "#/components/responses/TooManyRequests"
 */
import {
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
  ConfirmForgotPasswordCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { attributeValue, normalizeEmail } from "../../../utils/auth/cognitoProfile";
import { getErrorName } from "../../../utils/auth/errors";
import { isNonEmptyString, missingFields, readJsonObject } from "../../../utils/http/body";
import {
  createErrorResponse,
  createSuccessResponse,
} from "../../../utils/http/response";

const cognitoClient = new CognitoIdentityProviderClient({});

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

    const missing = missingFields(body.value, [
      "email",
      "confirmationCode",
      "newPassword",
    ]);
    if (missing.length > 0) {
      return createErrorResponse("Missing or empty required fields", 400, {
        code: "MISSING_REQUIRED_FIELDS",
        missingFields: missing,
      });
    }

    if (
      !isNonEmptyString(body.value.email) ||
      !isNonEmptyString(body.value.confirmationCode) ||
      !isNonEmptyString(body.value.newPassword)
    ) {
      return createErrorResponse("Missing or empty required fields", 400, {
        code: "MISSING_REQUIRED_FIELDS",
      });
    }

    const email = normalizeEmail(body.value.email);

    try {
      const existing = await cognitoClient.send(
        new AdminGetUserCommand({
          UserPoolId: userPoolId,
          Username: email,
        }),
      );
      if (attributeValue(existing.UserAttributes, "custom:authProvider") === "google") {
        return createErrorResponse("Password reset is not available for this account.", 400, {
          code: "CONFIRM_FORGOT_PASSWORD_NOT_ALLOWED",
        });
      }
    } catch (error) {
      if (getErrorName(error) === "UserNotFoundException") {
        return createErrorResponse("Invalid verification code", 400, {
          code: "INVALID_CODE",
        });
      }
      throw error;
    }

    try {
      await cognitoClient.send(
        new ConfirmForgotPasswordCommand({
          ClientId: clientId,
          Username: email,
          ConfirmationCode: body.value.confirmationCode.trim(),
          Password: body.value.newPassword,
        }),
      );
    } catch (error) {
      const name = getErrorName(error);
      if (name === "CodeMismatchException" || name === "UserNotFoundException") {
        return createErrorResponse("Invalid verification code", 400, {
          code: "INVALID_CODE",
        });
      }
      if (name === "ExpiredCodeException") {
        return createErrorResponse("Verification code has expired. Request a new code.", 400, {
          code: "CODE_EXPIRED",
        });
      }
      if (name === "InvalidPasswordException") {
        return createErrorResponse("Password does not meet requirements", 400, {
          code: "INVALID_PASSWORD",
          message: error instanceof Error ? error.message : undefined,
        });
      }
      if (name === "LimitExceededException" || name === "TooManyRequestsException") {
        return createErrorResponse("Too many attempts. Please try again later.", 429, {
          code: "RATE_LIMIT_EXCEEDED",
        });
      }
      throw error;
    }

    return createSuccessResponse({
      message: "Password has been reset. Sign in with your new password.",
    });
  } catch (error) {
    console.error(error);
    return createErrorResponse("Failed to confirm password reset", 500, {
      code: "INTERNAL_ERROR",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
