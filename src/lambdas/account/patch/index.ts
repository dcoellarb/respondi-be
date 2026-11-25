/**
 * @openapi
 * /account:
 *   patch:
 *     operationId: patchAccount
 *     summary: Update fields on the signed-in account profile
 *     tags: [Account]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: "#/components/schemas/ProfilePatch"
 *     responses:
 *       "200":
 *         description: Profile updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/Profile"
 *       "400":
 *         $ref: "#/components/responses/BadRequest"
 *       "401":
 *         $ref: "#/components/responses/Unauthorized"
 *       "404":
 *         $ref: "#/components/responses/NotFound"
 *       "409":
 *         $ref: "#/components/responses/Conflict"
 */
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
  handleAccount,
  notFound,
  readAccountBody,
  validationError,
} from "../../utils/account/http";
import { defaultStore } from "../../utils/account/store";
import { applyProfilePatch, parseProfilePatch } from "../../utils/account/validate";
import { createSuccessResponse } from "../../utils/http/response";

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> =>
  handleAccount(event, async ({ accountId }) => {
    const body = readAccountBody(event);
    if (!body.ok) return body.response;
    const parsed = parseProfilePatch(body.value);
    if (!parsed.ok) return validationError(parsed);

    const accounts = defaultStore();
    const current = await accounts.getProfile(accountId);
    if (!current) return notFound("Account profile not found", "ACCOUNT_NOT_FOUND");
    const merged = applyProfilePatch(current, parsed.value);
    if (!merged.ok) return validationError(merged);
    const saved = await accounts.saveProfile(accountId, current.email, merged.value);
    return createSuccessResponse(saved.profile);
  });
