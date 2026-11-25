/**
 * @openapi
 * /account/faqs:
 *   get:
 *     operationId: listFaqs
 *     summary: List FAQs for the signed-in account
 *     tags: [Account]
 *     responses:
 *       "200":
 *         description: FAQs ordered by sortOrder
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/FaqList"
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
    const faqs = await defaultStore().listFaqs(accountId);
    return createSuccessResponse({ items: faqs });
  });
