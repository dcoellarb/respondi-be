/**
 * @openapi
 * /auth/signup:
 *   post:
 *     operationId: signup
 *     summary: Create an account with email and password
 *     description: Creates a Cognito user and returns tokens. The business profile is created later with PUT /account.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password, firstName, lastName, acceptedTerms, acceptedTermsVersion]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *               acceptedTerms:
 *                 type: boolean
 *                 description: User explicitly accepted the Terms & Conditions. Must be true.
 *               acceptedTermsVersion:
 *                 type: string
 *                 description: Version identifier of the T&C the user accepted (e.g. "1.0").
 *               marketing:
 *                 type: boolean
 *                 description: User opted in to receive marketing communications. Defaults to false.
 *                 default: false
 *     responses:
 *       "200":
 *         description: Account created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/AuthSession"
 *       "400":
 *         $ref: "#/components/responses/BadRequest"
 *       "409":
 *         $ref: "#/components/responses/Conflict"
 *       "429":
 *         $ref: "#/components/responses/TooManyRequests"
 */
import {
  AdminDeleteUserCommand,
  AdminUpdateUserAttributesCommand,
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  SignUpCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
  cognitoIdFromIdToken,
  normalizeEmail,
  tokenResult,
} from "../../../utils/auth/cognitoProfile";
import { getErrorName } from "../../../utils/auth/errors";
import { isNonEmptyString, readJsonObject } from "../../../utils/http/body";
import {
  createErrorResponse,
  createSuccessResponse,
} from "../../../utils/http/response";
import { getDocumentClient } from "../../../utils/dynamo/client";
import { accountPk, CONSENT_SK } from "../../../utils/account/keys";

const cognitoClient = new CognitoIdentityProviderClient({});

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

async function rollbackCognitoUser(username: string): Promise<void> {
  const userPoolId = process.env.USER_POOL_ID;
  if (!userPoolId) return;
  try {
    await cognitoClient.send(
      new AdminDeleteUserCommand({
        UserPoolId: userPoolId,
        Username: username,
      }),
    );
  } catch (rollbackError) {
    console.error("Failed to roll back Cognito user after signup", {
      username,
      rollbackError,
    });
  }
}

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  let createdEmail: string | undefined;

  try {
    const body = readJsonObject(event);
    if (!body.ok) return body.response;

    const raw = body.value;
    const emailRaw = raw.email;
    const password = raw.password;
    const firstNameRaw = raw.firstName;
    const lastNameRaw = raw.lastName;

    // --- Validate original required string fields ---
    if (
      !isNonEmptyString(emailRaw) ||
      !isNonEmptyString(password) ||
      !isNonEmptyString(firstNameRaw) ||
      !isNonEmptyString(lastNameRaw)
    ) {
      const missing = ["email", "password", "firstName", "lastName"].filter(
        (field) => !isNonEmptyString(raw[field]),
      );
      return createErrorResponse("Missing or empty required fields", 400, {
        code: "MISSING_REQUIRED_FIELDS",
        missingFields: missing,
      });
    }

    // --- Validate acceptedTerms ---
    if (raw.acceptedTerms !== true) {
      return createErrorResponse(
        "User must accept terms and conditions",
        400,
        { code: "TERMS_NOT_ACCEPTED" },
      );
    }

    // --- Validate acceptedTermsVersion ---
    if (!isNonEmptyString(raw.acceptedTermsVersion)) {
      return createErrorResponse(
        "acceptedTermsVersion is required",
        400,
        { code: "MISSING_REQUIRED_FIELDS", missingFields: ["acceptedTermsVersion"] },
      );
    }
    const acceptedTermsVersion = (raw.acceptedTermsVersion as string).trim();

    // --- marketing defaults to false ---
    const marketing =
      raw.marketing === true ? true : false;

    const email = normalizeEmail(emailRaw);
    const firstName = firstNameRaw.trim();
    const lastName = lastNameRaw.trim();
    const clientId = requireEnv("CLIENT_ID");
    const userPoolId = requireEnv("USER_POOL_ID");

    try {
      await cognitoClient.send(
        new SignUpCommand({
          ClientId: clientId,
          Username: email,
          Password: password,
          UserAttributes: [
            { Name: "email", Value: email },
            { Name: "given_name", Value: firstName },
            { Name: "family_name", Value: lastName },
          ],
        }),
      );
      createdEmail = email;
    } catch (error) {
      const name = getErrorName(error);
      if (name === "UsernameExistsException" || name === "AliasExistsException") {
        return createErrorResponse("An account with this email already exists", 409, {
          code: "USER_ALREADY_EXISTS",
        });
      }
      if (name === "InvalidPasswordException") {
        return createErrorResponse("Password does not meet requirements", 400, {
          code: "INVALID_PASSWORD",
          message: error instanceof Error ? error.message : undefined,
        });
      }
      if (name === "InvalidParameterException") {
        return createErrorResponse("Invalid signup parameters", 400, {
          code: "INVALID_PARAMETER",
          message: error instanceof Error ? error.message : undefined,
        });
      }
      if (name === "TooManyRequestsException") {
        return createErrorResponse("Too many signup attempts. Please try again later.", 429, {
          code: "RATE_LIMIT_EXCEEDED",
        });
      }
      throw error;
    }

    await cognitoClient.send(
      new AdminUpdateUserAttributesCommand({
        UserPoolId: userPoolId,
        Username: email,
        UserAttributes: [{ Name: "custom:authProvider", Value: "email" }],
      }),
    );

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
      await rollbackCognitoUser(email);
      createdEmail = undefined;
      const name = getErrorName(error);
      if (name === "UserNotConfirmedException") {
        return createErrorResponse("Please confirm your email before signing in", 400, {
          code: "EMAIL_NOT_CONFIRMED",
        });
      }
      throw error;
    }

    const tokens = tokenResult(authResponse);
    const cognitoId = cognitoIdFromIdToken(tokens.IdToken);

    // --- Persist consent record for audit / GDPR compliance ---
    const tableName = requireEnv("TABLE_NAME");
    const now = new Date().toISOString();
    await getDocumentClient().send(
      new PutCommand({
        TableName: tableName,
        Item: {
          PK: accountPk(cognitoId),
          SK: CONSENT_SK,
          entityType: "CONSENT",
          accountId: cognitoId,
          acceptedTerms: true,
          acceptedTermsVersion,
          acceptedTermsAt: now,
          marketing,
          marketingOptInAt: marketing ? now : undefined,
          createdAt: now,
          updatedAt: now,
        },
      }),
    );

    createdEmail = undefined;

    return createSuccessResponse({
      message: "User signed up successfully",
      authResponse: tokens,
      user: {
        cognitoId,
        email,
        firstName,
        lastName,
        authProvider: "email",
      },
    });
  } catch (error) {
    if (createdEmail) await rollbackCognitoUser(createdEmail);
    console.error(error);
    return createErrorResponse("Failed to sign up user", 500, {
      code: "INTERNAL_ERROR",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
