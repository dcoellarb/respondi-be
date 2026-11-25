/**
 * @openapi
 * /account/products:
 *   post:
 *     operationId: createProduct
 *     summary: Add a product or service for the signed-in account
 *     tags: [Account]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: "#/components/schemas/ProductWrite"
 *     responses:
 *       "201":
 *         description: Product created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/Product"
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
  readAccountBody,
  validationError,
} from "../../../utils/account/http";
import { defaultStore } from "../../../utils/account/store";
import { parseProductWrite } from "../../../utils/account/validate";
import { createSuccessResponse } from "../../../utils/http/response";

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> =>
  handleAccount(event, async ({ accountId }) => {
    const body = readAccountBody(event);
    if (!body.ok) return body.response;
    const parsed = parseProductWrite(body.value);
    if (!parsed.ok) return validationError(parsed);
    const product = await defaultStore().createProduct(accountId, parsed.value);
    return createSuccessResponse(product, 201);
  });
