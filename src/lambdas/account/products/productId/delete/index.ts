/**
 * @openapi
 * /account/products/{productId}:
 *   delete:
 *     operationId: deleteProduct
 *     summary: Delete one product or service for the signed-in account
 *     tags: [Account]
 *     parameters:
 *       - $ref: "#/components/parameters/ProductId"
 *     responses:
 *       "200":
 *         description: Product deleted
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
 */
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { handleAccount, pathEntityId, validationError } from "../../../../utils/account/http";
import { defaultStore } from "../../../../utils/account/store";
import { createSuccessResponse } from "../../../../utils/http/response";

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> =>
  handleAccount(event, async ({ accountId }) => {
    const productId = pathEntityId(event, "productId");
    if (!productId.ok) return validationError(productId);
    await defaultStore().deleteProduct(accountId, productId.value);
    return createSuccessResponse({ deleted: true });
  });
