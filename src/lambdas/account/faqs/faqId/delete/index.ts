/**
 * @openapi
 * /account/faqs/{faqId}:
 *   delete:
 *     operationId: deleteFaq
 *     summary: Delete one FAQ for the signed-in account
 *     tags: [Account]
 *     parameters:
 *       - $ref: "#/components/parameters/FaqId"
 *     responses:
 *       "200":
 *         description: FAQ deleted
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/Deleted"
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
import { handleAccount, pathEntityId, validationError } from "../../../../utils/account/http";
import { defaultStore } from "../../../../utils/account/store";
import { createSuccessResponse } from "../../../../utils/http/response";

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> =>
  handleAccount(event, async ({ accountId }) => {
    const faqId = pathEntityId(event, "faqId");
    if (!faqId.ok) return validationError(faqId);
    await defaultStore().deleteFaq(accountId, faqId.value);
    return createSuccessResponse({ deleted: true });
  });
