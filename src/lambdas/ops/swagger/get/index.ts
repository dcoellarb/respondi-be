/**
 * Serves Swagger UI at GET /api/swagger and the OpenAPI document at
 * GET /api/swagger/swagger.json. Public; no Cognito.
 */
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import * as fs from "fs";
import * as path from "path";

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  try {
    const requestPath = event.path ?? "";

    if (
      requestPath.includes("/swagger.json") ||
      requestPath.includes("/openapi.json")
    ) {
      const openapiPath = path.join(__dirname, "openapi.json");
      const openApiSpec = JSON.parse(fs.readFileSync(openapiPath, "utf8")) as {
        servers?: Array<{ url: string; description?: string }>;
      };

      if (event.requestContext?.domainName) {
        const stage = event.requestContext.stage || "prod";
        openApiSpec.servers = [
          {
            url: `https://${event.requestContext.domainName}/${stage}/api`,
            description: "API Gateway endpoint",
          },
        ];
      }

      return {
        statusCode: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify(openApiSpec),
      };
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Respondi API</title>
  <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@5.10.5/swagger-ui.css">
  <style>
    body { margin: 0; padding: 0; }
    .topbar { display: none; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.10.5/swagger-ui-bundle.js"></script>
  <script src="https://unpkg.com/swagger-ui-dist@5.10.5/swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = function () {
      const baseUrl = window.location.origin + window.location.pathname.replace(/\\/swagger.*/, "");
      window.ui = SwaggerUIBundle({
        url: baseUrl + "/swagger/swagger.json",
        dom_id: "#swagger-ui",
        deepLinking: true,
        defaultModelRendering: "model",
        defaultModelsExpandDepth: 2,
        defaultModelExpandDepth: 2,
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
        plugins: [SwaggerUIBundle.plugins.DownloadUrl],
        layout: "StandaloneLayout",
        persistAuthorization: true,
        tryItOutEnabled: true,
        displayRequestDuration: true,
        filter: true
      });
    };
  </script>
</body>
</html>`;

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "text/html",
        "Access-Control-Allow-Origin": "*",
      },
      body: html,
    };
  } catch (error) {
    console.error("Error serving Swagger UI:", error);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        error: error instanceof Error ? error.message : "Failed to serve Swagger UI",
      }),
    };
  }
};
