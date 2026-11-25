/**
 * @openapi
 * /account/whatsapp:
 *   get:
 *     operationId: getWhatsAppConnection
 *     summary: Get WhatsApp Cloud API connection status for the signed-in account
 *     tags: [Account]
 *     responses:
 *       "200":
 *         description: Connection status (token is never returned)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [data]
 *               properties:
 *                 data:
 *                   $ref: "#/components/schemas/WhatsAppConnectionStatus"
 *       "401":
 *         $ref: "#/components/responses/Unauthorized"
 */
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { handleAccount } from "../../../utils/account/http";
import { createSuccessResponse } from "../../../utils/http/response";
import { getPublicWhatsAppConnection } from "../../../utils/whatsapp/connection-store";

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> =>
  handleAccount(event, async ({ accountId }) => {
    const connection = await getPublicWhatsAppConnection(accountId);
    return createSuccessResponse(connection);
  });
