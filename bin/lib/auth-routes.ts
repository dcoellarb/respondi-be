import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as lambda from "aws-cdk-lib/aws-lambda";

export interface AuthRouteFunctions {
  signup: lambda.IFunction;
  signin: lambda.IFunction;
  social: lambda.IFunction;
  signout: lambda.IFunction;
  refresh: lambda.IFunction;
  forgotPassword: lambda.IFunction;
  confirmForgotPassword: lambda.IFunction;
}

/**
 * Access tokens issued by this user pool include this scope.
 * Requiring it makes API Gateway accept access tokens on protected routes.
 */
const ACCESS_TOKEN_SCOPE = "aws.cognito.signin.user.admin";

export function addAuthRoutes(
  apiResource: apigateway.Resource,
  authorizer: apigateway.IAuthorizer,
  functions: AuthRouteFunctions,
): void {
  const integrate = (fn: lambda.IFunction) =>
    new apigateway.LambdaIntegration(fn);
  const publicMethod = { authorizationType: apigateway.AuthorizationType.NONE };
  const cognito = {
    authorizer,
    authorizationType: apigateway.AuthorizationType.COGNITO,
    authorizationScopes: [ACCESS_TOKEN_SCOPE],
  };

  const auth = apiResource.addResource("auth");
  auth.addResource("signup").addMethod("POST", integrate(functions.signup), publicMethod);
  auth.addResource("signin").addMethod("POST", integrate(functions.signin), publicMethod);
  auth.addResource("social").addMethod("POST", integrate(functions.social), publicMethod);
  auth.addResource("signout").addMethod("POST", integrate(functions.signout), cognito);
  auth.addResource("refresh").addMethod("POST", integrate(functions.refresh), publicMethod);
  auth
    .addResource("forgot-password")
    .addMethod("POST", integrate(functions.forgotPassword), publicMethod);
  auth
    .addResource("confirm-forgot-password")
    .addMethod("POST", integrate(functions.confirmForgotPassword), publicMethod);
}
