/**
 * @openapi
 * /plans:
 *   get:
 *     operationId: listPlans
 *     summary: List available subscription plans
 *     description: Returns the catalog of available plans. Public endpoint, no authentication required.
 *     tags: [Plans]
 *     responses:
 *       "200":
 *         description: Plans catalog
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [data]
 *               properties:
 *                 data:
 *                   type: object
 *                   required: [plans]
 *                   properties:
 *                     plans:
 *                       type: array
 *                       items:
 *                         $ref: "#/components/schemas/Plan"
 *       "500":
 *         $ref: "#/components/responses/InternalError"
 */
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { getDocumentClient, requireTableName } from "../../utils/dynamo/client";
import { PLANS_PK, PLANS_SK } from "../../utils/account/keys";
import {
  createErrorResponse,
  createSuccessResponse,
} from "../../utils/http/response";

export const handler = async (
  _event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  try {
    const doc = getDocumentClient();
    const tableName = requireTableName();
    const result = await doc.send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: PLANS_PK, SK: PLANS_SK },
      }),
    );
    const plans = (result.Item as Record<string, unknown> | undefined)?.plans;
    return createSuccessResponse({ plans: Array.isArray(plans) ? plans : [] });
  } catch (error) {
    console.error(error);
    return createErrorResponse("Failed to load plans", 500, {
      code: "INTERNAL_ERROR",
    });
  }
};
