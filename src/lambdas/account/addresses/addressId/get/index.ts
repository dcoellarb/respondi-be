/**
 * @openapi
 * /account/addresses/{addressId}:
 *   get:
 *     operationId: getAddress
 *     summary: Get one address for the signed-in account
 *     tags: [Account]
 *     parameters:
 *       - $ref: "#/components/parameters/AddressId"
 *     responses:
 *       "200":
 *         description: Address
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/Address"
 *       "400":
 *         $ref: "#/components/responses/BadRequest"
 *       "401":
 *         $ref: "#/components/responses/Unauthorized"
 *       "404":
 *         $ref: "#/components/responses/NotFound"
 */
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { handleAccount, notFound, pathEntityId, validationError } from "../../../../utils/account/http";
import { defaultStore } from "../../../../utils/account/store";
import { createSuccessResponse } from "../../../../utils/http/response";

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> =>
  handleAccount(event, async ({ accountId }) => {
    const addressId = pathEntityId(event, "addressId");
    if (!addressId.ok) return validationError(addressId);
    const address = await defaultStore().getAddress(accountId, addressId.value);
    if (!address) return notFound("Address not found", "ADDRESS_NOT_FOUND");
    return createSuccessResponse(address);
  });
