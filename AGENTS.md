# Project Context

This repository is the **Respondi backend**: an AWS CDK application written in TypeScript. It uses one stack per environment (`RespondiBeStack-development`, `RespondiBeStack-staging`, `RespondiBeStack-production`), Lambda + API Gateway for HTTP, and Cognito for auth.

## Lambdas

`src/lambdas/` — path-based layout (e.g. `auth/signup/post/`). One handler per folder; each `index.ts` exports `handler`. Shared code lives in `src/lambdas/utils/` and is copied into each handler bundle at build time.

## Infrastructure

CDK entry in `bin/respondi-be.ts`. Constructs live in `bin/lib/`. Keep a single stack per environment. Add new routes on the Rest API in that stack.

## Account

Same AWS account as Milos (`725921554236`, region `us-east-2`, CLI profile `aws-milos-pet-club`). Deploy only `RespondiBeStack-*`. Do not deploy, import, or modify `MilosClubBeStack-*`.

## Layers

Extra npm libraries that are not in the Node.js 22 runtime go in the node-modules layer (`scripts/build-node-modules-layer.js`, `bin/lib/node-modules-layer.ts`). `@aws-sdk/*` stays external.

## Build

`npm run build:all` compiles handlers into `dist/lambdas` and installs the layer into `dist/layers/node-modules`. CDK deploys those artifacts.

## Database

DynamoDB single table `RespondiBe-{env}` (`PK`, `SK`, TTL `expiresAt`). The account id is the Cognito `sub` from the access token, never a path, query, or body field. Item types:

- `PROFILE` — business profile
- `PHONE#{e164}` — unique phone lookup
- `ADDR#` — address
- `PROD#` — product
- `FAQ#` — FAQ (max 10)
- Short-lived `CONVERSATION#{accountId}#{customerE164}` (SK = creation ISO time) — last 6 WhatsApp turns; `expiresAt` = createdAt + 1 hour
- Short-lived `BLOCK#{quietE164}#{otherE164}` (SK = `ACTIVE`) — after business B auto-replies to A, blocks A from auto-replying to B for 1 hour

Profile tracks `conversationsThisMonth` / `conversationsMonth` (UTC `YYYY-MM`, lazy reset; max 100 new threads/month). Business hours live on the profile or on each address, depending on `scheduleMode`. Do not add RDS or Prisma.

## Auth

Cognito email/password plus Google ID-token sign-in. Login identity lives on the Cognito user (`custom:authProvider`, `custom:providerSubject`). The business profile, catalog, and FAQs live in DynamoDB. Email is copied from Cognito and is not editable.

## WhatsApp Webhook

Public `GET|POST /api/webhooks/whatsapp`. GET echoes Meta `hub.challenge` after verify-token check. POST validates `X-Hub-Signature-256`. Credentials are in Secrets Manager `RespondiBeStack-{env}-whatsapp-webhook` (`verifyToken`, `appSecret`, `appId`, optional env `accessToken`); Lambdas get `WHATSAPP_WEBHOOK_SECRET_NAME` only. Protect with API Gateway method throttling and a regional WAF IP rate limit on that path. Do not put Cognito on this route.

## WhatsApp Connect

Authenticated `POST /api/account/whatsapp/connect` completes Meta Embedded Signup (exchange `code`, subscribe WABA, optional phone register, store `ACC#/WHATSAPP` with business token + ids, sync profile phone). `GET|DELETE /api/account/whatsapp` for status/disconnect. Webhook send prefers the per-account token when present.

## Swagger

Public `GET /api/swagger` (UI) and `GET /api/swagger/swagger.json`. Built from `openapi:generate` into `src/lambdas/ops/swagger/get/openapi.json` and copied into the Lambda bundle at build time.

## Constraints

- Do not add Express, Fastify, or any other HTTP server framework. All APIs are served only via API Gateway and Lambda.
- Do not add RDS or Prisma.
- Do not deploy, import, or modify `MilosClubBeStack-*`.
