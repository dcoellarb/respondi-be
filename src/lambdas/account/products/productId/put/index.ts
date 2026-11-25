/**
 * @openapi
 * /account/products/{productId}:
 *   put:
 *     operationId: putProduct
 *     summary: Replace one product or service for the signed-in account
 *     tags: [Account]
 *     parameters:
 *       - $ref: "#/components/parameters/ProductId"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: "#/components/schemas/ProductWrite"
 *     responses:
 *       "200":
 *         description: Product replaced
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
  pathEntityId,
  readAccountBody,
  validationError,
} from "../../../../utils/account/http";
import { defaultStore } from "../../../../utils/account/store";
import { parseProductWrite } from "../../../../utils/account/validate";
import { createSuccessResponse } from "../../../../utils/http/response";

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> =>
  handleAccount(event, async ({ accountId }) => {
    const productId = pathEntityId(event, "productId");
    if (!productId.ok) return validationError(productId);
    const body = readAccountBody(event);
    if (!body.ok) return body.response;
    const parsed = parseProductWrite(body.value);
    if (!parsed.ok) return validationError(parsed);
    const product = await defaultStore().saveProduct(accountId, productId.value, parsed.value);
    return createSuccessResponse(product);
  });
