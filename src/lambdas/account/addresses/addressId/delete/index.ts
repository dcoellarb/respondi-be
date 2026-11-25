/**
 * @openapi
 * /account/addresses/{addressId}:
 *   delete:
 *     operationId: deleteAddress
 *     summary: Delete one address for the signed-in account
 *     tags: [Account]
 *     parameters:
 *       - $ref: "#/components/parameters/AddressId"
 *     responses:
 *       "200":
 *         description: Address deleted
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
    const addressId = pathEntityId(event, "addressId");
    if (!addressId.ok) return validationError(addressId);
    await defaultStore().deleteAddress(accountId, addressId.value);
    return createSuccessResponse({ deleted: true });
  });
