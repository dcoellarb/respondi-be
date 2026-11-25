/**
 * @openapi
 * /account/products:
 *   get:
 *     operationId: listProducts
 *     summary: List products and services for the signed-in account
 *     tags: [Account]
 *     parameters:
 *       - $ref: "#/components/parameters/ProductLimit"
 *       - $ref: "#/components/parameters/ProductCursor"
 *     responses:
 *       "200":
 *         description: Product page
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ProductPage"
 *       "400":
 *         $ref: "#/components/responses/BadRequest"
 *       "401":
 *         $ref: "#/components/responses/Unauthorized"
 *       "404":
 *         $ref: "#/components/responses/NotFound"
 */
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { handleAccount, validationError } from "../../../utils/account/http";
import { defaultStore } from "../../../utils/account/store";
import { parseProductPage } from "../../../utils/account/validate";
import { createSuccessResponse } from "../../../utils/http/response";

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> =>
  handleAccount(event, async ({ accountId }) => {
    const page = parseProductPage(event.queryStringParameters);
    if (!page.ok) return validationError(page);
    const products = await defaultStore().listProducts(accountId, page.value);
    return createSuccessResponse(products);
  });
