/**
 * @openapi
 * /webhooks/whatsapp:
 *   get:
 *     operationId: verifyWhatsAppWebhook
 *     summary: Meta webhook verification handshake
 *     description: |-
 *       Meta sends this GET when the Callback URL or Verify token is set in the App Dashboard.
 *       On success the response body is the plain-text hub.challenge value (not JSON).
 *       This route is public. Protect it with the Secrets Manager verifyToken, API Gateway throttling, and WAF IP rate limits.
 *     tags: [Webhooks]
 *     parameters:
 *       - name: hub.mode
 *         in: query
 *         required: true
 *         schema:
 *           type: string
 *           enum: [subscribe]
 *       - name: hub.verify_token
 *         in: query
 *         required: true
 *         schema:
 *           type: string
 *       - name: hub.challenge
 *         in: query
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       "200":
 *         description: Verification accepted. Body is hub.challenge as text/plain.
 *         content:
 *           text/plain:
 *             schema:
 *               type: string
 *       "403":
 *         description: Verify token mismatch or missing configuration
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [error]
 *               properties:
 *                 error:
 *                   type: string
 */
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
  challengeResponse,
  webhookError,
} from "../../../utils/whatsapp/http";
import { getWhatsAppWebhookSecrets } from "../../../utils/whatsapp/secrets";

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  try {
    let verifyToken: string;
    try {
      ({ verifyToken } = await getWhatsAppWebhookSecrets());
    } catch (error) {
      console.error(error);
      return webhookError(
        error instanceof Error ? error.message : "WhatsApp webhook is not configured",
        403,
      );
    }

    const query = event.queryStringParameters ?? {};
    const mode = query["hub.mode"];
    const token = query["hub.verify_token"];
    const challenge = query["hub.challenge"];

    if (mode !== "subscribe") {
      return webhookError("Invalid hub.mode", 403);
    }
    if (!token || token !== verifyToken) {
      return webhookError("Invalid hub.verify_token", 403);
    }
    if (!challenge) {
      return webhookError("Missing hub.challenge", 403);
    }

    return challengeResponse(challenge);
  } catch (error) {
    console.error(error);
    return webhookError(
      error instanceof Error ? error.message : "Failed to verify WhatsApp webhook",
      500,
    );
  }
};
