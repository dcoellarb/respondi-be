/**
 * @openapi
 * /account:
 *   put:
 *     operationId: putAccount
 *     summary: Create or replace the signed-in account profile
 *     description: Email is copied from Cognito and cannot be sent in the body. The account id is the access token subject.
 *     tags: [Account]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: "#/components/schemas/ProfileWrite"
 *     responses:
 *       "200":
 *         description: Profile replaced
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/Profile"
 *       "201":
 *         description: Profile created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/Profile"
 *       "400":
 *         $ref: "#/components/responses/BadRequest"
 *       "401":
 *         $ref: "#/components/responses/Unauthorized"
 *       "409":
 *         $ref: "#/components/responses/Conflict"
 */
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
  handleAccount,
  readAccountBody,
  validationError,
} from "../../utils/account/http";
import { defaultStore } from "../../utils/account/store";
import { parseProfileWrite } from "../../utils/account/validate";
import { emailForUsername } from "../../utils/auth/cognitoEmail";
import { createSuccessResponse } from "../../utils/http/response";

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> =>
  handleAccount(event, async ({ accountId, username }) => {
    const body = readAccountBody(event);
    if (!body.ok) return body.response;
    const parsed = parseProfileWrite(body.value);
    if (!parsed.ok) return validationError(parsed);

    const accounts = defaultStore();
    const existing = await accounts.getProfile(accountId);
    const email = existing?.email ?? (await emailForUsername(username));
    const saved = await accounts.saveProfile(accountId, email, parsed.value);
    return createSuccessResponse(saved.profile, saved.created ? 201 : 200);
  });
