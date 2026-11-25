/**
 * @openapi
 * /account/faqs:
 *   post:
 *     operationId: createFaq
 *     summary: Add an FAQ for the signed-in account
 *     description: An account can store at most 10 FAQs.
 *     tags: [Account]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: "#/components/schemas/FaqCreate"
 *     responses:
 *       "201":
 *         description: FAQ created
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
 *       "409":
 *         $ref: "#/components/responses/Conflict"
 */
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
  handleAccount,
  readAccountBody,
  validationError,
} from "../../../utils/account/http";
import { defaultStore } from "../../../utils/account/store";
import { parseFaqWrite } from "../../../utils/account/validate";
import { createSuccessResponse } from "../../../utils/http/response";

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> =>
  handleAccount(event, async ({ accountId }) => {
    const body = readAccountBody(event);
    if (!body.ok) return body.response;
    const parsed = parseFaqWrite(body.value, false);
    if (!parsed.ok) return validationError(parsed);
    const faq = await defaultStore().createFaq(accountId, parsed.value);
    return createSuccessResponse(faq, 201);
  });
