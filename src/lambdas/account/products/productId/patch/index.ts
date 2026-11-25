/**
 * @openapi
 * /account/products/{productId}:
 *   patch:
 *     operationId: patchProduct
 *     summary: Update fields on one product or service for the signed-in account
 *     tags: [Account]
 *     parameters:
 *       - $ref: "#/components/parameters/ProductId"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: "#/components/schemas/ProductPatch"
 *     responses:
 *       "200":
 *         description: Product updated
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
  notFound,
  pathEntityId,
  readAccountBody,
  validationError,
} from "../../../../utils/account/http";
import { defaultStore } from "../../../../utils/account/store";
import { applyProductPatch, parseProductPatch } from "../../../../utils/account/validate";
import { createSuccessResponse } from "../../../../utils/http/response";

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> =>
  handleAccount(event, async ({ accountId }) => {
    const productId = pathEntityId(event, "productId");
    if (!productId.ok) return validationError(productId);
    const body = readAccountBody(event);
    if (!body.ok) return body.response;
    const parsed = parseProductPatch(body.value);
    if (!parsed.ok) return validationError(parsed);

    const accounts = defaultStore();
    const current = await accounts.getProduct(accountId, productId.value);
    if (!current) return notFound("Product not found", "PRODUCT_NOT_FOUND");
    const product = await accounts.saveProduct(
      accountId,
      productId.value,
      applyProductPatch(current, parsed.value),
    );
    return createSuccessResponse(product);
  });
