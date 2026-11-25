import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as lambda from "aws-cdk-lib/aws-lambda";

/**
 * Public Swagger UI and OpenAPI JSON. Same pattern as milos-club-be.
 */
export function addSwaggerRoutes(
  apiResource: apigateway.Resource,
  swaggerFunction: lambda.IFunction,
): void {
  const integrate = new apigateway.LambdaIntegration(swaggerFunction);
  const publicMethod = {
    authorizationType: apigateway.AuthorizationType.NONE,
  };

  const swagger = apiResource.addResource("swagger");
  swagger.addMethod("GET", integrate, publicMethod);
  swagger.addResource("swagger.json").addMethod("GET", integrate, publicMethod);
}
