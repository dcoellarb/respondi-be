# Respondi Backend

Serverless API for Respondi, the WhatsApp FAQ bot for small businesses. This repo is the AWS CDK app: one stack per environment, TypeScript Lambdas, and a shared layer for extra Node libraries.

Account data lives in one DynamoDB table per environment, `RespondiBe-development`, `RespondiBe-staging`, and `RespondiBe-production`. Cognito remains the login store. The business profile is created after signup.

## Architecture

- **CDK** entry: `bin/respondi-be.ts`
- **One stack per environment:** `RespondiBeStack-development`, `RespondiBeStack-staging`, `RespondiBeStack-production`
- **Lambdas:** `src/lambdas/<path>/index.ts`, compiled to `dist/lambdas/<path>/index.js`
- **Shared code:** `src/lambdas/utils/` is copied into each handler that imports it
- **Layer:** `jose` (Google token verification) is installed into `dist/layers/node-modules` and attached to the social sign-in Lambda
- **Runtime:** Node.js 22. `@aws-sdk/*` comes from the Lambda runtime and is not bundled
- **Table:** `RespondiBe-{env}` with `PK` and `SK`. Profile, phone lookup, addresses, products, and FAQs are items in that table

## Auth

| Method | Path | Auth |
| --- | --- | --- |
| POST | `/api/auth/signup` | Public. Email, password, first name, last name |
| POST | `/api/auth/signin` | Public. Email and password |
| POST | `/api/auth/social` | Public. `{ "provider": "google", "idToken": "..." }` |
| POST | `/api/auth/refresh` | Public. `{ "refreshToken": "..." }` |
| POST | `/api/auth/forgot-password` | Public. Email accounts only |
| POST | `/api/auth/confirm-forgot-password` | Public. Email, code, new password |
| POST | `/api/auth/signout` | Cognito access token |

Protected routes expect `Authorization: Bearer <accessToken>`. The pre sign-up trigger auto-confirms email so signup can return tokens immediately.

Google sign-in verifies the Google ID token, then Cognito issues its own tokens through a custom auth challenge. The web client id must be in `GOOGLE_CLIENT_IDS` at deploy time. An email that already has a password account is not linked to Google.

Successful responses use `{ "data": ... }`. Errors use `{ "error": "...", "code": "..." }`.

## Account data

Every account route requires `Authorization: Bearer <accessToken>`. The account id is the token `sub`. `userId`, `accountId`, `email`, and `cognitoId` are rejected in the path, query, and body. Email is copied from Cognito on the first save and is not updated later.

| Method | Path | Purpose |
| --- | --- | --- |
| GET, PUT, PATCH | `/api/account` | Business profile. `phone` is E.164 and unique. `scheduleMode` is `business` or `per_address` |
| GET, POST | `/api/account/addresses` | Store addresses. Hours are stored here only when `scheduleMode` is `per_address` |
| GET, PUT, PATCH, DELETE | `/api/account/addresses/{addressId}` | One address |
| GET, POST | `/api/account/products` | Products and services. `priceMinor` is an integer in minor currency units. GET accepts `limit` and `cursor` |
| GET, PUT, PATCH, DELETE | `/api/account/products/{productId}` | One product |
| GET, POST | `/api/account/faqs` | FAQs, at most 10 |
| GET, PUT, PATCH, DELETE | `/api/account/faqs/{faqId}` | One FAQ |
| GET, DELETE | `/api/account/whatsapp` | WhatsApp Cloud API connection status / disconnect |
| POST | `/api/account/whatsapp/connect` | Finish Meta Embedded Signup (`code`, `wabaId`, `phoneNumberId`, `pin`) |

`hours` entries are `{ "dayOfWeek": "monday", "start": "09:00", "end": "17:00" }`. Windows on the same day cannot overlap. Image URLs must be `https`.

## WhatsApp webhook

| Method | Path | Auth |
| --- | --- | --- |
| GET | `/api/webhooks/whatsapp` | Public. Meta verification. Returns `hub.challenge` as `text/plain` when `hub.verify_token` matches |
| POST | `/api/webhooks/whatsapp` | Public. Requires `X-Hub-Signature-256: sha256=<hmac>` over the raw body using Secrets Manager `appSecret` |

Successful POST responses are `{ "reply": "hello world" }`. Failures are `{ "error": "..." }`. Use stack output `WhatsAppWebhookUrl` as the Meta Callback URL.

Webhook credentials live in Secrets Manager as `RespondiBeStack-{env}-whatsapp-webhook` (JSON keys `verifyToken`, `appSecret`, `appId`, and optional env-level `accessToken`, initially `REPLACE_ME`). Set `appId` + `appSecret` for Embedded Signup code exchange. Per-account business tokens from `POST /api/account/whatsapp/connect` are stored on the account and preferred when sending. The Lambdas receive only `WHATSAPP_WEBHOOK_SECRET_NAME`. After deploy, update values in the AWS console (stack output `WhatsAppWebhookSecretName`).

Protection on this open route:

- Meta verify token on GET and HMAC signature on POST
- API Gateway method throttling (GET 10 rps / burst 20, POST 25 rps / burst 50)
- AWS WAF regional web ACL with a per-IP rate limit on `/webhooks/whatsapp` (200 requests / 5 minutes)

## Prerequisites

- Node.js 22 and pnpm 10
- AWS CLI profile `aws-milos-pet-club` for account `725921554236`
- Region `us-east-2`

```bash
cp .env.example .env
# set GOOGLE_CLIENT_IDS to the web OAuth client id
pnpm install
```

## Scripts

```bash
pnpm test
pnpm run lint
pnpm run build:all
pnpm run openapi:generate
pnpm run synth
pnpm run deploy:development
pnpm run seed:demo -- --env development
```

`deploy:only:*` skips the build and deploys the artifacts already in `dist/`. Development loads `.env`. Staging and production load `.env.staging` and `.env.production`.

`pnpm run seed:demo -- --env development|staging|production` creates (or reuses) Cognito user `demo@respondi.live` / `Demo1989!` and upserts the CircuitFit demo profile, phone `+593980000000`, address, products, and FAQs into `RespondiBe-{env}`. Pass `--dry-run` to preview. Idempotent: re-running refreshes the password and overwrites demo Dynamo items for that Cognito `sub`.

`pnpm run openapi:generate` rebuilds `openapi.json` (and the Swagger lambda copy) from the `@openapi` comments on each handler and the shared schemas in `openapi/components.yaml`. `build:all` runs that first. `pnpm run openapi:check` fails when the committed file is stale.

After deploy, Swagger UI is at `{ApiUrl}api/swagger` (stack output `SwaggerUrl`).

Pass `-c env=development|staging|production` to synth or deploy one stack. Omit it and CDK defines all three.

Every deploy targets account `725921554236` in `us-east-2`, the same account as Milos. CloudFormation changes only the stack you name (`RespondiBeStack-development`, `RespondiBeStack-staging`, or `RespondiBeStack-production`). User pools, Lambdas, and the API use that stack prefix (`RespondiBeStack-development-userpool`, and so on), which is separate from `MilosClubBeStack-*`. The account bill and service quotas are shared. Milos stacks stay untouched.

## Adding a Lambda

1. Create `src/lambdas/<path>/index.ts` exporting `handler`.
2. Run `pnpm run build:all`.
3. Register it with `createFn` in `bin/lib/respondi-be-stack.ts` and add the route on the API.

If the handler needs an npm library that is not in the Lambda runtime, add it to `package.json` dependencies and to `LAYER_PACKAGES` in `scripts/build-node-modules-layer.js`, then pass `layers: [nodeModulesLayer.layer]` into `createFn`.
