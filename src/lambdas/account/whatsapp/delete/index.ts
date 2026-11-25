/**
 * @openapi
 * /account/whatsapp:
 *   delete:
 *     operationId: disconnectWhatsApp
 *     summary: Remove the stored WhatsApp Cloud API connection for the signed-in account
 *     description: |
 *       Deletes the per-account business token and ids. Does not change the profile phone
 *       or call Meta to unregister the number.
 *     tags: [Account]
 *     responses:
 *       "200":
 *         description: Disconnected (or already disconnected)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [data]
 *               properties:
 *                 data:
 *                   type: object
 *                   required: [connected]
 *                   properties:
 *                     connected:
 *                       type: boolean
 *                       enum: [false]
 *       "401":
 *         $ref: "#/components/responses/Unauthorized"
 */
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { handleAccount } from "../../../utils/account/http";
import { createSuccessResponse } from "../../../utils/http/response";
import { deleteWhatsAppConnection } from "../../../utils/whatsapp/connection-store";

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> =>
  handleAccount(event, async ({ accountId }) => {
    await deleteWhatsAppConnection(accountId);
    return createSuccessResponse({ connected: false as const });
  });
