/**
 * @openapi
 * /account/whatsapp/connect:
 *   post:
 *     operationId: connectWhatsApp
 *     summary: Complete WhatsApp Embedded Signup for the signed-in account
 *     description: |
 *       Exchanges the Meta Embedded Signup `code` for a business token, subscribes
 *       the Respondi app to the customer's WABA webhooks, optionally registers the
 *       phone for Cloud API, stores the connection on the account, and syncs the
 *       profile phone to Meta's `display_phone_number`.
 *
 *       Frontend must POST immediately — the exchangeable code expires in ~30s.
 *       Send `wabaId` and `phoneNumberId` from the `WA_EMBEDDED_SIGNUP` session event.
 *     tags: [Account]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: "#/components/schemas/WhatsAppConnectRequest"
 *     responses:
 *       "200":
 *         description: WhatsApp connected
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [data]
 *               properties:
 *                 data:
 *                   $ref: "#/components/schemas/WhatsAppConnection"
 *       "400":
 *         $ref: "#/components/responses/BadRequest"
 *       "401":
 *         $ref: "#/components/responses/Unauthorized"
 *       "404":
 *         $ref: "#/components/responses/NotFound"
 *       "409":
 *         $ref: "#/components/responses/Conflict"
 *       "502":
 *         description: Meta Graph API error
 */
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
  handleAccount,
  notFound,
  readAccountBody,
  validationError,
} from "../../../utils/account/http";
import { defaultStore } from "../../../utils/account/store";
import { FieldError } from "../../../utils/account/types";
import { isNonEmptyString } from "../../../utils/http/body";
import {
  createErrorResponse,
  createSuccessResponse,
} from "../../../utils/http/response";
import { saveWhatsAppConnection } from "../../../utils/whatsapp/connection-store";
import {
  exchangeEmbeddedSignupCode,
  fetchWhatsAppDisplayPhone,
  registerWhatsAppPhoneNumber,
  subscribeWhatsAppApp,
  WhatsAppGraphError,
} from "../../../utils/whatsapp/embedded-signup";
import {
  getWhatsAppWebhookSecrets,
  isWhatsAppAppIdConfigured,
} from "../../../utils/whatsapp/secrets";

function parseConnectBody(
  raw: Record<string, unknown>,
):
  | {
      ok: true;
      value: {
        code: string;
        wabaId: string;
        phoneNumberId: string;
        pin?: string;
        skipRegister: boolean;
      };
    }
  | FieldError {
  if (!isNonEmptyString(raw.code)) {
    return { ok: false, error: "code is required", code: "MISSING_REQUIRED_FIELDS" };
  }
  if (!isNonEmptyString(raw.wabaId)) {
    return { ok: false, error: "wabaId is required", code: "MISSING_REQUIRED_FIELDS" };
  }
  if (!isNonEmptyString(raw.phoneNumberId)) {
    return {
      ok: false,
      error: "phoneNumberId is required",
      code: "MISSING_REQUIRED_FIELDS",
    };
  }

  const skipRegister = raw.skipRegister === true;
  let pin: string | undefined;
  if (isNonEmptyString(raw.pin)) {
    pin = raw.pin.trim();
    if (!/^\d{6}$/.test(pin)) {
      return {
        ok: false,
        error: "pin must be a 6-digit two-step verification PIN",
        code: "INVALID_PIN",
      };
    }
  } else if (!skipRegister) {
    return {
      ok: false,
      error: "pin is required unless skipRegister is true (coexistence)",
      code: "MISSING_REQUIRED_FIELDS",
    };
  }

  return {
    ok: true,
    value: {
      code: raw.code.trim(),
      wabaId: raw.wabaId.trim(),
      phoneNumberId: raw.phoneNumberId.trim(),
      pin,
      skipRegister,
    },
  };
}

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> =>
  handleAccount(event, async ({ accountId }) => {
    const body = readAccountBody(event);
    if (!body.ok) return body.response;

    const parsed = parseConnectBody(body.value);
    if (!parsed.ok) return validationError(parsed);

    const profile = await defaultStore().getProfile(accountId);
    if (!profile) return notFound("Account profile not found", "ACCOUNT_NOT_FOUND");

    let secrets;
    try {
      secrets = await getWhatsAppWebhookSecrets();
    } catch (error) {
      console.error(error);
      return createErrorResponse("WhatsApp app credentials are not configured", 500, {
        code: "WHATSAPP_SECRET_MISSING",
      });
    }

    if (!isWhatsAppAppIdConfigured(secrets.appId)) {
      return createErrorResponse(
        "WhatsApp appId is not configured in Secrets Manager",
        500,
        { code: "WHATSAPP_APP_ID_MISSING" },
      );
    }

    try {
      const accessToken = await exchangeEmbeddedSignupCode({
        appId: secrets.appId,
        appSecret: secrets.appSecret,
        code: parsed.value.code,
      });

      await subscribeWhatsAppApp({
        wabaId: parsed.value.wabaId,
        accessToken,
      });

      if (!parsed.value.skipRegister && parsed.value.pin) {
        await registerWhatsAppPhoneNumber({
          phoneNumberId: parsed.value.phoneNumberId,
          accessToken,
          pin: parsed.value.pin,
        });
      }

      const phoneE164 = await fetchWhatsAppDisplayPhone({
        phoneNumberId: parsed.value.phoneNumberId,
        accessToken,
      });

      const owner = await defaultStore().findAccountIdByPhone(phoneE164);
      if (owner && owner !== accountId) {
        return createErrorResponse(
          "This WhatsApp phone number is already linked to another account",
          409,
          { code: "PHONE_IN_USE" },
        );
      }

      if (profile.phone !== phoneE164 || !profile.whatsappBusinessInUse) {
        await defaultStore().saveProfile(accountId, profile.email, {
          businessName: profile.businessName,
          phone: phoneE164,
          whatsappBusinessInUse: true,
          contactName: profile.contactName,
          contactPhone: profile.contactPhone,
          scheduleMode: profile.scheduleMode,
          hours: profile.hours,
        });
      }

      const connection = await saveWhatsAppConnection({
        accountId,
        wabaId: parsed.value.wabaId,
        phoneNumberId: parsed.value.phoneNumberId,
        phoneE164,
        accessToken,
      });

      return createSuccessResponse(connection);
    } catch (error) {
      if (error instanceof WhatsAppGraphError) {
        const status = error.status >= 400 && error.status < 600 ? error.status : 502;
        return createErrorResponse(error.message, status >= 500 ? 502 : status, {
          code: error.code ?? "WHATSAPP_GRAPH_ERROR",
        });
      }
      throw error;
    }
  });
