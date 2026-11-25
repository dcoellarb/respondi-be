/**
 * @openapi
 * /account/addresses/{addressId}:
 *   patch:
 *     operationId: patchAddress
 *     summary: Update fields on one address for the signed-in account
 *     tags: [Account]
 *     parameters:
 *       - $ref: "#/components/parameters/AddressId"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: "#/components/schemas/AddressPatch"
 *     responses:
 *       "200":
 *         description: Address updated
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
import {
  handleAccount,
  notFound,
  pathEntityId,
  readAccountBody,
  validationError,
} from "../../../../utils/account/http";
import { defaultStore } from "../../../../utils/account/store";
import { applyAddressPatch, parseAddressPatch } from "../../../../utils/account/validate";
import { createSuccessResponse } from "../../../../utils/http/response";

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> =>
  handleAccount(event, async ({ accountId }) => {
    const addressId = pathEntityId(event, "addressId");
    if (!addressId.ok) return validationError(addressId);
    const body = readAccountBody(event);
    if (!body.ok) return body.response;
    const parsed = parseAddressPatch(body.value);
    if (!parsed.ok) return validationError(parsed);

    const accounts = defaultStore();
    const current = await accounts.getAddress(accountId, addressId.value);
    if (!current) return notFound("Address not found", "ADDRESS_NOT_FOUND");
    const address = await accounts.saveAddress(
      accountId,
      addressId.value,
      applyAddressPatch(current, parsed.value),
    );
    return createSuccessResponse(address);
  });
