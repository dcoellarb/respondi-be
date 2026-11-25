/**
 * @openapi
 * /account/faqs/{faqId}:
 *   patch:
 *     operationId: patchFaq
 *     summary: Update fields on one FAQ for the signed-in account
 *     tags: [Account]
 *     parameters:
 *       - $ref: "#/components/parameters/FaqId"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: "#/components/schemas/FaqPatch"
 *     responses:
 *       "200":
 *         description: FAQ updated
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
  notFound,
  pathEntityId,
  readAccountBody,
  validationError,
} from "../../../../utils/account/http";
import { defaultStore } from "../../../../utils/account/store";
import { applyFaqPatch, parseFaqPatch } from "../../../../utils/account/validate";
import { createSuccessResponse } from "../../../../utils/http/response";

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> =>
  handleAccount(event, async ({ accountId }) => {
    const faqId = pathEntityId(event, "faqId");
    if (!faqId.ok) return validationError(faqId);
    const body = readAccountBody(event);
    if (!body.ok) return body.response;
    const parsed = parseFaqPatch(body.value);
    if (!parsed.ok) return validationError(parsed);

    const accounts = defaultStore();
    const current = await accounts.getFaq(accountId, faqId.value);
    if (!current) return notFound("FAQ not found", "FAQ_NOT_FOUND");
    const faq = await accounts.saveFaq(
      accountId,
      faqId.value,
      applyFaqPatch(current, parsed.value),
    );
    return createSuccessResponse(faq);
  });
