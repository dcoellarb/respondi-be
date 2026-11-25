import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as lambda from "aws-cdk-lib/aws-lambda";

export function addPlansRoutes(
  apiResource: apigateway.Resource,
  plansFunction: lambda.IFunction,
): void {
  apiResource.addResource("plans").addMethod(
    "GET",
    new apigateway.LambdaIntegration(plansFunction),
    { authorizationType: apigateway.AuthorizationType.NONE },
  );
}
