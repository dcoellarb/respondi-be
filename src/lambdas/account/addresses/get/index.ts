/**
 * @openapi
 * /account/addresses:
 *   get:
 *     operationId: listAddresses
 *     summary: List addresses for the signed-in account
 *     tags: [Account]
 *     responses:
 *       "200":
 *         description: Addresses
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/AddressList"
 *       "401":
 *         $ref: "#/components/responses/Unauthorized"
 *       "404":
 *         $ref: "#/components/responses/NotFound"
 */
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { handleAccount } from "../../../utils/account/http";
import { defaultStore } from "../../../utils/account/store";
import { createSuccessResponse } from "../../../utils/http/response";

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> =>
  handleAccount(event, async ({ accountId }) => {
    const addresses = await defaultStore().listAddresses(accountId);
    return createSuccessResponse({ items: addresses });
  });
