/**
 * @openapi
 * /auth/signin:
 *   post:
 *     operationId: signin
 *     summary: Sign in with email and password
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *     responses:
 *       "200":
 *         description: Signed in
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/AuthSession"
 *       "400":
 *         $ref: "#/components/responses/BadRequest"
 *       "401":
 *         $ref: "#/components/responses/Unauthorized"
 *       "429":
 *         $ref: "#/components/responses/TooManyRequests"
 */
import {
  CognitoIdentityProviderClient,
  GetUserCommand,
  InitiateAuthCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
  authUserFromAttributes,
  tokenResult,
} from "../../../utils/auth/cognitoProfile";
import { getErrorName } from "../../../utils/auth/errors";
import { missingFields, readJsonObject } from "../../../utils/http/body";
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

    const missing = missingFields(body.value, ["email", "password"]);
    if (missing.length > 0) {
      return createErrorResponse("Missing or empty required fields", 400, {
        code: "MISSING_REQUIRED_FIELDS",
        missingFields: missing,
      });
    }

    const email = String(body.value.email).trim().toLowerCase();
    const password = String(body.value.password);
    const clientId = process.env.CLIENT_ID;
    if (!clientId) {
      throw new Error("CLIENT_ID is not configured");
    }

    let authResponse;
    try {
      authResponse = await cognitoClient.send(
        new InitiateAuthCommand({
          AuthFlow: "USER_PASSWORD_AUTH",
          ClientId: clientId,
          AuthParameters: {
            USERNAME: email,
            PASSWORD: password,
          },
        }),
      );
    } catch (error) {
      const name = getErrorName(error);
      if (name === "NotAuthorizedException" || name === "UserNotFoundException") {
        return createErrorResponse("Incorrect email or password", 401, {
          code: "INVALID_CREDENTIALS",
        });
      }
      if (name === "UserNotConfirmedException") {
        return createErrorResponse("Please confirm your email before signing in", 400, {
          code: "EMAIL_NOT_CONFIRMED",
        });
      }
      if (name === "PasswordResetRequiredException") {
        return createErrorResponse("Password reset is required before signing in", 400, {
          code: "PASSWORD_RESET_REQUIRED",
        });
      }
      if (name === "TooManyRequestsException") {
        return createErrorResponse("Too many sign-in attempts. Please try again later.", 429, {
          code: "RATE_LIMIT_EXCEEDED",
        });
      }
      throw error;
    }

    const tokens = tokenResult(authResponse);
    const current = await cognitoClient.send(
      new GetUserCommand({ AccessToken: tokens.AccessToken }),
    );

    return createSuccessResponse({
      message: "User signed in successfully",
      authResponse: tokens,
      user: authUserFromAttributes(current.UserAttributes),
    });
  } catch (error) {
    console.error(error);
    return createErrorResponse("Failed to sign in user", 500, {
      code: "INTERNAL_ERROR",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
