/**
 * @openapi
 * /account:
 *   get:
 *     operationId: getAccount
 *     summary: Get the signed-in account profile
 *     tags: [Account]
 *     responses:
 *       "200":
 *         description: Account profile
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/Profile"
 *       "401":
 *         $ref: "#/components/responses/Unauthorized"
 *       "404":
 *         $ref: "#/components/responses/NotFound"
 */
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { handleAccount, notFound } from "../../utils/account/http";
import { defaultStore } from "../../utils/account/store";
import { createSuccessResponse } from "../../utils/http/response";

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> =>
  handleAccount(event, async ({ accountId }) => {
    const profile = await defaultStore().getProfile(accountId);
    if (!profile) return notFound("Account profile not found", "ACCOUNT_NOT_FOUND");
    return createSuccessResponse(profile);
  });
