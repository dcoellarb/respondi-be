/**
 * @openapi
 * /account/addresses/{addressId}:
 *   put:
 *     operationId: putAddress
 *     summary: Replace one address for the signed-in account
 *     tags: [Account]
 *     parameters:
 *       - $ref: "#/components/parameters/AddressId"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: "#/components/schemas/AddressWrite"
 *     responses:
 *       "200":
 *         description: Address replaced
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
  pathEntityId,
  readAccountBody,
  validationError,
} from "../../../../utils/account/http";
import { defaultStore } from "../../../../utils/account/store";
import { parseAddressWrite } from "../../../../utils/account/validate";
import { createSuccessResponse } from "../../../../utils/http/response";

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> =>
  handleAccount(event, async ({ accountId }) => {
    const addressId = pathEntityId(event, "addressId");
    if (!addressId.ok) return validationError(addressId);
    const body = readAccountBody(event);
    if (!body.ok) return body.response;
    const parsed = parseAddressWrite(body.value);
    if (!parsed.ok) return validationError(parsed);
    const address = await defaultStore().saveAddress(
      accountId,
      addressId.value,
      parsed.value,
    );
    return createSuccessResponse(address);
  });
