import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as lambda from "aws-cdk-lib/aws-lambda";

export interface AccountRouteFunctions {
  getAccount: lambda.IFunction;
  putAccount: lambda.IFunction;
  patchAccount: lambda.IFunction;
  listAddresses: lambda.IFunction;
  createAddress: lambda.IFunction;
  getAddress: lambda.IFunction;
  putAddress: lambda.IFunction;
  patchAddress: lambda.IFunction;
  deleteAddress: lambda.IFunction;
  listProducts: lambda.IFunction;
  createProduct: lambda.IFunction;
  getProduct: lambda.IFunction;
  putProduct: lambda.IFunction;
  patchProduct: lambda.IFunction;
  deleteProduct: lambda.IFunction;
  listFaqs: lambda.IFunction;
  createFaq: lambda.IFunction;
  getFaq: lambda.IFunction;
  putFaq: lambda.IFunction;
  patchFaq: lambda.IFunction;
  deleteFaq: lambda.IFunction;
  getWhatsApp: lambda.IFunction;
  connectWhatsApp: lambda.IFunction;
  disconnectWhatsApp: lambda.IFunction;
}

const ACCESS_TOKEN_SCOPE = "aws.cognito.signin.user.admin";

export function addAccountRoutes(
  apiResource: apigateway.Resource,
  authorizer: apigateway.IAuthorizer,
  functions: AccountRouteFunctions,
): void {
  const integrate = (fn: lambda.IFunction) => new apigateway.LambdaIntegration(fn);
  const cognito = {
    authorizer,
    authorizationType: apigateway.AuthorizationType.COGNITO,
    authorizationScopes: [ACCESS_TOKEN_SCOPE],
  };

  const account = apiResource.addResource("account");
  account.addMethod("GET", integrate(functions.getAccount), cognito);
  account.addMethod("PUT", integrate(functions.putAccount), cognito);
  account.addMethod("PATCH", integrate(functions.patchAccount), cognito);

  const addresses = account.addResource("addresses");
  addresses.addMethod("GET", integrate(functions.listAddresses), cognito);
  addresses.addMethod("POST", integrate(functions.createAddress), cognito);
  const address = addresses.addResource("{addressId}");
  address.addMethod("GET", integrate(functions.getAddress), cognito);
  address.addMethod("PUT", integrate(functions.putAddress), cognito);
  address.addMethod("PATCH", integrate(functions.patchAddress), cognito);
  address.addMethod("DELETE", integrate(functions.deleteAddress), cognito);

  const products = account.addResource("products");
  products.addMethod("GET", integrate(functions.listProducts), cognito);
  products.addMethod("POST", integrate(functions.createProduct), cognito);
  const product = products.addResource("{productId}");
  product.addMethod("GET", integrate(functions.getProduct), cognito);
  product.addMethod("PUT", integrate(functions.putProduct), cognito);
  product.addMethod("PATCH", integrate(functions.patchProduct), cognito);
  product.addMethod("DELETE", integrate(functions.deleteProduct), cognito);

  const faqs = account.addResource("faqs");
  faqs.addMethod("GET", integrate(functions.listFaqs), cognito);
  faqs.addMethod("POST", integrate(functions.createFaq), cognito);
  const faq = faqs.addResource("{faqId}");
  faq.addMethod("GET", integrate(functions.getFaq), cognito);
  faq.addMethod("PUT", integrate(functions.putFaq), cognito);
  faq.addMethod("PATCH", integrate(functions.patchFaq), cognito);
  faq.addMethod("DELETE", integrate(functions.deleteFaq), cognito);

  const whatsapp = account.addResource("whatsapp");
  whatsapp.addMethod("GET", integrate(functions.getWhatsApp), cognito);
  whatsapp.addMethod("DELETE", integrate(functions.disconnectWhatsApp), cognito);
  const connect = whatsapp.addResource("connect");
  connect.addMethod("POST", integrate(functions.connectWhatsApp), cognito);
}
