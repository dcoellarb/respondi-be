/**
 * @openapi
 * /account/faqs/{faqId}:
 *   get:
 *     operationId: getFaq
 *     summary: Get one FAQ for the signed-in account
 *     tags: [Account]
 *     parameters:
 *       - $ref: "#/components/parameters/FaqId"
 *     responses:
 *       "200":
 *         description: FAQ
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/Faq"
 *       "400":
 *         $ref: "#/components/responses/BadRequest"
 *       "401":
 *         $ref: "#/components/responses/Unauthorized"
 *       "404":
 *         $ref: "#/components/responses/NotFound"
 */
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { handleAccount, notFound, pathEntityId, validationError } from "../../../../utils/account/http";
import { defaultStore } from "../../../../utils/account/store";
import { createSuccessResponse } from "../../../../utils/http/response";

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> =>
  handleAccount(event, async ({ accountId }) => {
    const faqId = pathEntityId(event, "faqId");
    if (!faqId.ok) return validationError(faqId);
    const faq = await defaultStore().getFaq(accountId, faqId.value);
    if (!faq) return notFound("FAQ not found", "FAQ_NOT_FOUND");
    return createSuccessResponse(faq);
  });
