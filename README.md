# Respondi Backend

Serverless API for Respondi, the WhatsApp FAQ bot for small businesses. This repo is the AWS CDK app: one stack per environment, TypeScript Lambdas, and a shared layer for extra Node libraries.

Database persistence is intentionally not here yet. Cognito is the account store until RDS or DynamoDB is chosen.

## Architecture

- **CDK** entry: `bin/respondi-be.ts`
- **One stack per environment:** `RespondiBeStack-development`, `RespondiBeStack-staging`, `RespondiBeStack-production`
- **Lambdas:** `src/lambdas/<path>/index.ts`, compiled to `dist/lambdas/<path>/index.js`
- **Shared code:** `src/lambdas/utils/` is copied into each handler that imports it
- **Layer:** `jose` (Google token verification) is installed into `dist/layers/node-modules` and attached to the social sign-in Lambda
- **Runtime:** Node.js 22. `@aws-sdk/*` comes from the Lambda runtime and is not bundled

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

## Prerequisites

- Node.js 22 and pnpm 10
- AWS CLI profile `aws-respondi` for the Respondi account (not the Milos account)
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
pnpm run synth
pnpm run deploy:development
```

`deploy:only:*` skips the build and deploys the artifacts already in `dist/`. Staging and production load `.env.staging` and `.env.production`.

CDK uses the account from the `aws-respondi` profile. There is no hardcoded account id.

## Adding a Lambda

1. Create `src/lambdas/<path>/index.ts` exporting `handler`.
2. Run `pnpm run build:all`.
3. Register it with `createFn` in `bin/lib/respondi-be-stack.ts` and add the route on the API.

If the handler needs an npm library that is not in the Lambda runtime, add it to `package.json` dependencies and to `LAYER_PACKAGES` in `scripts/build-node-modules-layer.js`, then pass `layers: [nodeModulesLayer.layer]` into `createFn`.
