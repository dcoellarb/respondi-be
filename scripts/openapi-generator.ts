#!/usr/bin/env ts-node

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

const ROOT = path.join(__dirname, "..");
const LAMBDAS_DIR = path.join(ROOT, "src/lambdas");
const COMPONENTS_PATH = path.join(ROOT, "openapi/components.yaml");
const OUTPUT_PATH = path.join(ROOT, "openapi.json");
const SWAGGER_OUTPUT_PATH = path.join(
  ROOT,
  "src/lambdas/ops/swagger/get/openapi.json",
);

/**
 * API Gateway serves these routes without the Cognito authorizer.
 * Every other operation uses the access token.
 */
const PUBLIC_OPERATIONS: Array<{ path: string; method: string }> = [
  { path: "/auth/signup", method: "post" },
  { path: "/auth/signin", method: "post" },
  { path: "/auth/social", method: "post" },
  { path: "/auth/refresh", method: "post" },
  { path: "/auth/forgot-password", method: "post" },
  { path: "/auth/confirm-forgot-password", method: "post" },
  { path: "/webhooks/whatsapp", method: "get" },
  { path: "/webhooks/whatsapp", method: "post" },
];

const ERROR_SCHEMA = {
  $ref: "#/components/schemas/Error",
};

export function renderOpenApi(): string {
  return `${JSON.stringify(buildOpenApiSpec(), null, 2)}\n`;
}

export function buildOpenApiSpec(): Record<string, unknown> {
  const componentsDoc = yaml.load(fs.readFileSync(COMPONENTS_PATH, "utf8")) as {
    components?: Record<string, unknown>;
  };

  const spec: {
    openapi: string;
    info: Record<string, string>;
    servers: unknown[];
    tags: unknown[];
    security: unknown[];
    components: Record<string, unknown>;
    paths: Record<string, Record<string, unknown>>;
  } = {
    openapi: "3.0.3",
    info: {
      title: "Respondi API",
      version: "0.1.0",
      description:
        "Auth and account API for Respondi. Paths are relative to the /api base. The account id is the Cognito access token subject.",
    },
    servers: [
      {
        url: "https://{apiId}.execute-api.us-east-2.amazonaws.com/prod/api",
        description:
          "Deployed API Gateway stage. Replace apiId with the ApiUrl output for the environment.",
        variables: {
          apiId: {
            default: "your-api-id",
          },
        },
      },
    ],
    tags: [
      { name: "Auth", description: "Cognito email and Google sign-in" },
      { name: "Account", description: "Business profile, addresses, catalog, and FAQs" },
      {
        name: "Webhooks",
        description:
          "Public Meta WhatsApp webhook. Protected by verify token, HMAC signature, API Gateway throttling, and WAF IP rate limits",
      },
    ],
    security: [{ CognitoAuth: [] }],
    components: componentsDoc.components ?? {},
    paths: {},
  };

  const statusCodesByOperation = new Map<string, number[]>();

  for (const file of findHandlerFiles(LAMBDAS_DIR)) {
    const content = fs.readFileSync(file, "utf8");
    const block = extractOpenapiBlock(content);
    if (!block) continue;

    let doc: unknown;
    try {
      doc = yaml.load(block);
    } catch (error) {
      throw new Error(
        `Failed to parse @openapi block in ${path.relative(ROOT, file)}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (!doc || typeof doc !== "object") continue;

    mergePathItems(spec.paths, doc as Record<string, unknown>);

    const errorCodes = extractErrorStatusCodes(content);
    for (const [pathKey, pathItem] of Object.entries(doc as Record<string, unknown>)) {
      if (!pathItem || typeof pathItem !== "object") continue;
      for (const method of Object.keys(pathItem as Record<string, unknown>)) {
        const opKey = `${method.toLowerCase()} ${pathKey}`;
        const existing = statusCodesByOperation.get(opKey) ?? [];
        statusCodesByOperation.set(
          opKey,
          Array.from(new Set([...existing, ...errorCodes])).sort((left, right) => left - right),
        );
      }
    }
  }

  applyPublicSecurity(spec);
  wrapSuccessResponses(spec);
  ensureErrorResponses(spec, statusCodesByOperation);
  return spec;
}

function errorResponse(): Record<string, unknown> {
  return {
    description: "Error response",
    content: { "application/json": { schema: ERROR_SCHEMA } },
  };
}

function findHandlerFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir)) {
    if (entry.startsWith(".")) continue;
    const fullPath = path.join(dir, entry);
    if (fs.statSync(fullPath).isDirectory()) {
      files.push(...findHandlerFiles(fullPath));
    } else if (entry === "index.ts") {
      files.push(fullPath);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function extractOpenapiBlock(content: string): string | null {
  const match = content.match(/\/\*\*([\s\S]*?)\*\//);
  if (!match) return null;
  const jsdoc = match[1];
  const marker = jsdoc.indexOf("@openapi");
  if (marker === -1) return null;
  return jsdoc.slice(marker + "@openapi".length).replace(/^\s*\*/gm, "");
}

function mergePathItems(
  target: Record<string, Record<string, unknown>>,
  incoming: Record<string, unknown>,
): void {
  for (const [pathKey, pathItem] of Object.entries(incoming)) {
    if (!pathItem || typeof pathItem !== "object" || Array.isArray(pathItem)) continue;
    target[pathKey] = {
      ...(target[pathKey] ?? {}),
      ...(pathItem as Record<string, unknown>),
    };
  }
}

function extractErrorStatusCodes(source: string): number[] {
  const codes = new Set<number>();
  const pattern = /createErrorResponse\([\s\S]*?,\s*(\d{3})\s*(?:,|\))/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    codes.add(Number(match[1]));
  }
  return [...codes];
}

function applyPublicSecurity(spec: {
  paths: Record<string, Record<string, unknown>>;
}): void {
  for (const operation of PUBLIC_OPERATIONS) {
    const pathItem = spec.paths[operation.path];
    const value = pathItem?.[operation.method];
    if (value && typeof value === "object") {
      (value as { security: unknown[] }).security = [];
    }
  }
}

function wrapSuccessResponses(spec: {
  paths: Record<string, Record<string, unknown>>;
}): void {
  for (const [pathKey, pathItem] of Object.entries(spec.paths)) {
    // Webhook success bodies are wire-format ({ reply }) or text/plain challenge.
    if (pathKey.startsWith("/webhooks/")) continue;
    for (const operation of Object.values(pathItem)) {
      if (!operation || typeof operation !== "object") continue;
      const responses = (operation as { responses?: Record<string, unknown> }).responses;
      if (!responses) continue;
      for (const [statusCode, response] of Object.entries(responses)) {
        if (!/^2\d\d$/.test(statusCode) || !response || typeof response !== "object") continue;
        const content = (response as { content?: Record<string, { schema?: unknown }> }).content?.[
          "application/json"
        ];
        const schema = content?.schema;
        if (!schema || typeof schema !== "object") continue;
        const record = schema as { type?: string; properties?: { data?: unknown } };
        if (record.type === "object" && record.properties?.data) continue;
        content.schema = {
          type: "object",
          required: ["data"],
          properties: { data: schema },
        };
      }
    }
  }
}

function ensureErrorResponses(
  spec: { paths: Record<string, Record<string, unknown>> },
  statusCodesByOperation: Map<string, number[]>,
): void {
  for (const [pathKey, pathItem] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!operation || typeof operation !== "object") continue;
      const responses = ((operation as { responses?: Record<string, unknown> }).responses ??
        {}) as Record<string, unknown>;
      (operation as { responses: Record<string, unknown> }).responses = responses;

      const codes = statusCodesByOperation.get(`${method.toLowerCase()} ${pathKey}`) ?? [];
      for (const code of codes) {
        const key = String(code);
        if (!responses[key]) {
          responses[key] = errorResponse();
        }
      }
      if (!responses["500"]) {
        responses["500"] = {
          $ref: "#/components/responses/InternalError",
        };
      }
    }
  }
}

if (require.main === module) {
  const rendered = renderOpenApi();
  if (process.argv.includes("--check")) {
    const current = fs.existsSync(OUTPUT_PATH) ? fs.readFileSync(OUTPUT_PATH, "utf8") : "";
    const swaggerCurrent = fs.existsSync(SWAGGER_OUTPUT_PATH)
      ? fs.readFileSync(SWAGGER_OUTPUT_PATH, "utf8")
      : "";
    if (current !== rendered || swaggerCurrent !== rendered) {
      console.error("openapi.json is out of date. Run pnpm run openapi:generate.");
      process.exit(1);
    }
    console.log("openapi.json is up to date");
  } else if (process.argv.includes("--stdout")) {
    process.stdout.write(rendered);
  } else {
    fs.mkdirSync(path.dirname(SWAGGER_OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, rendered);
    fs.writeFileSync(SWAGGER_OUTPUT_PATH, rendered);
    console.log(`OpenAPI spec generated at ${OUTPUT_PATH}`);
    console.log(`Swagger lambda copy at ${SWAGGER_OUTPUT_PATH}`);
  }
}
