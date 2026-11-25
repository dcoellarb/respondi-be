/**
 * @openapi
 * /account/faqs/{faqId}:
 *   put:
 *     operationId: putFaq
 *     summary: Replace one FAQ for the signed-in account
 *     tags: [Account]
 *     parameters:
 *       - $ref: "#/components/parameters/FaqId"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: "#/components/schemas/FaqReplace"
 *     responses:
 *       "200":
 *         description: FAQ replaced
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
import {
  handleAccount,
  pathEntityId,
  readAccountBody,
  validationError,
} from "../../../../utils/account/http";
import { defaultStore } from "../../../../utils/account/store";
import { parseFaqWrite } from "../../../../utils/account/validate";
import { createSuccessResponse } from "../../../../utils/http/response";

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> =>
  handleAccount(event, async ({ accountId }) => {
    const faqId = pathEntityId(event, "faqId");
    if (!faqId.ok) return validationError(faqId);
    const body = readAccountBody(event);
    if (!body.ok) return body.response;
    const parsed = parseFaqWrite(body.value, true);
    if (!parsed.ok) return validationError(parsed);
    const faq = await defaultStore().saveFaq(accountId, faqId.value, parsed.value);
    return createSuccessResponse(faq);
  });
