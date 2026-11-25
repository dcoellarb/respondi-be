/**
 * @openapi
 * /account/addresses:
 *   post:
 *     operationId: createAddress
 *     summary: Add an address for the signed-in account
 *     tags: [Account]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: "#/components/schemas/AddressWrite"
 *     responses:
 *       "201":
 *         description: Address created
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
import { parseAddressWrite } from "../../../utils/account/validate";
import { createSuccessResponse } from "../../../utils/http/response";

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> =>
  handleAccount(event, async ({ accountId }) => {
    const body = readAccountBody(event);
    if (!body.ok) return body.response;
    const parsed = parseAddressWrite(body.value);
    if (!parsed.ok) return validationError(parsed);
    const address = await defaultStore().createAddress(accountId, parsed.value);
    return createSuccessResponse(address, 201);
  });
