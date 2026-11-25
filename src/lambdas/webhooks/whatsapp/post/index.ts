/**
 * @openapi
 * /webhooks/whatsapp:
 *   post:
 *     operationId: receiveWhatsAppWebhook
 *     summary: Receive WhatsApp Cloud API webhook events
 *     description: |-
 *       Accepts Meta WhatsApp message webhooks. Validates X-Hub-Signature-256 with Secrets
 *       Manager `appSecret`. Resolves the business via `metadata.display_phone_number` →
 *       PHONE# lookup, loads short-lived conversation history (last 6 turns), classifies
 *       with Nova Micro (sources multi-label), loads Dynamo context, then drafts a reply
 *       with Amazon Nova Pro, persists conversation history, then sends via Cloud API
 *       `POST /{phone-number-id}/messages` when Secrets Manager `accessToken` is set.
 *       The 200 body still includes `whatsappMessage`. Conversations use creation-time SK and
 *       DynamoDB TTL (`expiresAt` = createdAt + 1 hour). While `appSecret` is REPLACE_ME,
 *       signature verification is skipped; while `accessToken` is REPLACE_ME, send is skipped.
 *       Optional body `isSimulation: true` (Respondi test clients only) also skips Cloud API send.
 *       Optional body `startClean: true` deletes any existing conversation for the customer
 *       phone before processing so the turn starts with empty history.
 *       New conversation threads are capped at 100 per UTC calendar month per account (lazy reset).
 *       After an auto-reply from business B to customer A, writes short-lived
 *       `BLOCK#A#B` (TTL 1 hour). If A is also a Respondi business and later receives
 *       B's message, the webhook skips auto-reply so coexistence phones do not loop.
 *     tags: [Webhooks]
 *     parameters:
 *       - name: X-Hub-Signature-256
 *         in: header
 *         required: false
 *         description: |-
 *           Meta webhook signature (`sha256=` + hex HMAC-SHA256 of the raw body). Required
 *           once Secrets Manager `appSecret` is a real value; optional while it is REPLACE_ME.
 *         schema:
 *           type: string
 *           example: sha256=0f33d19b24cad5b296d44458b10928c067806de10e206d65b7a1e0004da35496
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [object, entry]
 *             properties:
 *               object:
 *                 type: string
 *                 enum: [whatsapp_business_account]
 *               entry:
 *                 type: array
 *                 items:
 *                   type: object
 *               isSimulation:
 *                 type: boolean
 *                 description: |-
 *                   Respondi test harness only. When true, runs the full reply pipeline but
 *                   does not call WhatsApp Cloud API send. Meta webhooks omit this field.
 *               startClean:
 *                 type: boolean
 *                 description: |-
 *                   Respondi test harness only. When true, deletes any existing conversation
 *                   for the customer phone before processing so history starts empty.
 *                   Meta webhooks omit this field.
 *     responses:
 *       "200":
 *         description: Webhook accepted; includes outbound WhatsApp Cloud API message body
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [whatsappMessage]
 *               properties:
 *                 whatsappMessage:
 *                   type: object
 *                   required: [messaging_product, to, type, text]
 *                   properties:
 *                     messaging_product:
 *                       type: string
 *                       enum: [whatsapp]
 *                     recipient_type:
 *                       type: string
 *                       enum: [individual]
 *                     to:
 *                       type: string
 *                       description: Customer phone as Meta expects it (usually digits, no +)
 *                     type:
 *                       type: string
 *                       enum: [text]
 *                     text:
 *                       type: object
 *                       required: [body]
 *                       properties:
 *                         preview_url:
 *                           type: boolean
 *                         body:
 *                           type: string
 *       "400":
 *         description: Invalid payload, missing phone, or missing text message
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [error]
 *               properties:
 *                 error:
 *                   type: string
 *       "401":
 *         description: Missing or invalid signature
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [error]
 *               properties:
 *                 error:
 *                   type: string
 *       "403":
 *         description: Webhook secret is not configured
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [error]
 *               properties:
 *                 error:
 *                   type: string
 *       "404":
 *         description: No account owns the business phone in the payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [error]
 *               properties:
 *                 error:
 *                   type: string
 *       "422":
 *         description: |-
 *           Message is not business-related, or it is business-related but account
 *           data cannot answer it (no outbound WhatsApp message is produced).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [error]
 *               properties:
 *                 error:
 *                   type: string
 *       "429":
 *         description: Monthly WhatsApp conversation quota exceeded (100 / UTC month)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [error]
 *               properties:
 *                 error:
 *                   type: string
 */
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { isAccountError } from "../../../utils/account/errors";
import { defaultStore } from "../../../utils/account/store";
import {
  loadAnswerContext,
  summarizeAnswerContext,
} from "../../../utils/whatsapp/answer-context";
import { classifyBusinessIntent } from "../../../utils/whatsapp/business-intent";
import {
  appendConversationMessages,
  clearConversations,
  formatConversationForPrompt,
  getConversation,
} from "../../../utils/whatsapp/conversation";
import { generateWhatsAppReply } from "../../../utils/whatsapp/generate-reply";
import {
  headerValue,
  rawBody,
  webhookError,
  webhookReply,
} from "../../../utils/whatsapp/http";
import { extractWhatsAppInboundText } from "../../../utils/whatsapp/message";
import {
  buildWhatsAppTextMessage,
  sendWhatsAppTextMessage,
} from "../../../utils/whatsapp/outbound";
import {
  isWhatsAppSimulationPayload,
  isWhatsAppStartCleanPayload,
  isWhatsAppWebhookPayload,
} from "../../../utils/whatsapp/payload";
import {
  extractWhatsAppBusinessPhone,
  normalizeWhatsAppCustomerPhone,
} from "../../../utils/whatsapp/phone";
import {
  getWhatsAppWebhookSecrets,
  isWhatsAppSendConfigured,
} from "../../../utils/whatsapp/secrets";
import { getWhatsAppConnection } from "../../../utils/whatsapp/connection-store";
import {
  isWhatsAppReplyBlocked,
  putWhatsAppReplyBlock,
} from "../../../utils/whatsapp/reply-block";
import { verifyWhatsAppSignature } from "../../../utils/whatsapp/signature";

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  try {
    let appSecret: string;
    let envAccessToken: string;
    try {
      ({ appSecret, accessToken: envAccessToken } = await getWhatsAppWebhookSecrets());
    } catch (error) {
      console.error(error);
      return webhookError(
        error instanceof Error ? error.message : "WhatsApp webhook is not configured",
        403,
      );
    }

    const body = rawBody(event);
    if (!body) {
      return webhookError("Request body is required", 400);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return webhookError("Invalid JSON in request body", 400);
    }

    // Simulation requests (Respondi test harness) skip HMAC — they never come from Meta
    // and the frontend does not have the app secret. WAF rate limiting still applies.
    const simulation = isWhatsAppSimulationPayload(parsed);

    // Dummy CDK seed value: skip HMAC so Swagger/local probes work before Meta secrets are set.
    if (!simulation && appSecret !== "REPLACE_ME") {
      const signature = headerValue(event, "X-Hub-Signature-256");
      if (!verifyWhatsAppSignature(body, signature, appSecret)) {
        return webhookError("Invalid WhatsApp webhook signature", 401);
      }
    }

    if (!isWhatsAppWebhookPayload(parsed)) {
      return webhookError("Payload is not a WhatsApp business account webhook", 400);
    }

    const phoneE164 = extractWhatsAppBusinessPhone(parsed);
    if (!phoneE164) {
      return webhookError(
        "WhatsApp business phone (metadata.display_phone_number) is required",
        400,
      );
    }

    const accountId = await defaultStore().findAccountIdByPhone(phoneE164);
    if (!accountId) {
      return webhookError("No account found for WhatsApp business phone", 404);
    }

    const inbound = extractWhatsAppInboundText(parsed);
    if (!inbound) {
      return webhookError("WhatsApp text message body and from are required", 400);
    }

    const customerPhoneE164 = normalizeWhatsAppCustomerPhone(inbound.from);
    if (!customerPhoneE164) {
      return webhookError("WhatsApp customer phone (messages[].from) is invalid", 400);
    }

    // Loop guard: if this business recently messaged `from` as a customer, stay quiet.
    try {
      if (await isWhatsAppReplyBlocked(phoneE164, customerPhoneE164)) {
        console.log("WhatsApp auto-reply blocked", {
          businessPhoneE164: phoneE164,
          customerPhoneE164,
          accountId,
        });
        return webhookReply({
          skipped: true,
          reason: "reply_blocked",
        });
      }
    } catch (error) {
      // Fail open — still serve customers if the block lookup fails.
      console.error("Failed to check WhatsApp reply block", error);
    }

    const isSimulation = simulation;
    const startClean = isWhatsAppStartCleanPayload(parsed);

    let conversation = null;
    try {
      if (startClean) {
        const deleted = await clearConversations(accountId, customerPhoneE164);
        console.log("WhatsApp startClean cleared conversation", {
          accountId,
          customerPhoneE164,
          deleted,
        });
      } else {
        conversation = await getConversation(accountId, customerPhoneE164);
      }
    } catch (error) {
      console.error(error);
      return webhookError(
        error instanceof Error
          ? error.message
          : startClean
            ? "Failed to clear conversation"
            : "Failed to load conversation",
        500,
      );
    }
    // New threads consume monthly quota; continuing an open conversation does not.
    // Simulation harness skips quota so FE tests do not burn the account limit.
    if (!conversation && !isSimulation) {
      try {
        const quota = await defaultStore().consumeConversationQuota(accountId);
        if (!quota.allowed) {
          return webhookError(
            `Monthly conversation limit reached (${quota.count}/${quota.limit} in ${quota.month})`,
            429,
          );
        }
      } catch (error) {
        console.error(error);
        return webhookError(
          error instanceof Error ? error.message : "Failed to check conversation quota",
          500,
        );
      }
    }

    // Message cap: each reply counts against the plan's messagesCap.
    // Simulation harness skips so FE tests are not blocked by plan restrictions.
    if (!isSimulation) {
      try {
        const msgQuota = await defaultStore().consumeMessageQuota(accountId);
        if (!msgQuota.allowed) {
          return webhookError(
            `Monthly message limit reached (${msgQuota.count}/${msgQuota.cap} in ${msgQuota.year}-${String(msgQuota.month).padStart(2, "0")})`,
            429,
          );
        }
      } catch (error) {
        // NO_PLAN → no active subscription
        if (isAccountError(error) && error.code === "NO_PLAN") {
          return webhookError("No active subscription plan", 403);
        }
        console.error(error);
        return webhookError(
          error instanceof Error ? error.message : "Failed to check message quota",
          500,
        );
      }
    }

    const conversationHistory = conversation
      ? formatConversationForPrompt(conversation.messages)
      : "";

    let intent;
    try {
      intent = await classifyBusinessIntent(inbound.text, conversationHistory);
    } catch (error) {
      console.error(error);
      return webhookError(
        error instanceof Error ? error.message : "Failed to classify WhatsApp message",
        500,
      );
    }

    if (!intent.businessRelated) {
      const reason = `Message is not business-related: ${intent.reason}`;
      await safeAppendConversation({
        accountId,
        customerPhoneE164,
        existing: conversation,
        messages: [
          { direction: "inbound", text: inbound.text },
          { direction: "system", text: reason },
        ],
      });
      return webhookError(reason, 422);
    }

    const store = defaultStore();
    let context;
    try {
      context = await loadAnswerContext(store, accountId, intent.sources);
    } catch (error) {
      console.error(error);
      return webhookError(
        error instanceof Error ? error.message : "Failed to load account context",
        500,
      );
    }

    let reply;
    try {
      reply = await generateWhatsAppReply({
        customerMessage: inbound.text,
        context,
        sources: intent.sources,
        intentReason: intent.reason,
        conversationHistory,
        firstTurn: !(conversation?.messages ?? []).some(
          (message) => message.direction === "outbound",
        ),
      });
    } catch (error) {
      console.error(error);
      return webhookError(
        error instanceof Error ? error.message : "Failed to generate WhatsApp reply",
        500,
      );
    }

    if (!reply.answered) {
      const reason = `Cannot answer from account data: ${reply.reason}`;
      await safeAppendConversation({
        accountId,
        customerPhoneE164,
        existing: conversation,
        messages: [
          { direction: "inbound", text: inbound.text },
          { direction: "system", text: reason },
        ],
      });
      console.log("WhatsApp webhook unanswerable", {
        accountId,
        phoneE164,
        customerFrom: inbound.from,
        sources: intent.sources,
        reason: intent.reason,
        unansweredReason: reply.reason,
        context: summarizeAnswerContext(context),
      });
      return webhookError(reason, 422);
    }

    const whatsappMessage = buildWhatsAppTextMessage(inbound.from, reply.text);

    await safeAppendConversation({
      accountId,
      customerPhoneE164,
      existing: conversation,
      messages: [
        { direction: "inbound", text: inbound.text },
        { direction: "outbound", text: reply.text },
      ],
    });

    // Customer A messaged business B → A must not auto-reply when B's answer arrives.
    await safePutReplyBlock(customerPhoneE164, phoneE164);

    const accountConnection = await getWhatsAppConnection(accountId);
    const accessToken = accountConnection?.accessToken || envAccessToken;
    const sendPhoneNumberId =
      accountConnection?.phoneNumberId || inbound.phoneNumberId;

    const shouldSend =
      !isSimulation && isWhatsAppSendConfigured(accessToken);

    let cloudMessageId: string | null = null;
    if (shouldSend) {
      try {
        const sent = await sendWhatsAppTextMessage({
          phoneNumberId: sendPhoneNumberId,
          accessToken,
          message: whatsappMessage,
        });
        cloudMessageId = sent.messageId;
      } catch (error) {
        console.error(error);
        return webhookError(
          error instanceof Error ? error.message : "Failed to send WhatsApp message",
          502,
        );
      }
    } else if (isSimulation) {
      console.log("WhatsApp simulation request; skipping Cloud API send");
    } else {
      console.warn(
        "WhatsApp accessToken is REPLACE_ME or missing; skipping Cloud API send",
      );
    }

    console.log("WhatsApp webhook accepted", {
      accountId,
      phoneE164,
      customerFrom: inbound.from,
      businessRelated: true,
      sources: intent.sources,
      reason: intent.reason,
      context: summarizeAnswerContext(context),
      replyLength: reply.text.length,
      conversationMessages: conversation?.messages.length ?? 0,
      cloudMessageId,
      isSimulation,
      startClean,
      sentToWhatsApp: shouldSend,
      entries: Array.isArray((parsed as { entry?: unknown }).entry)
        ? (parsed as { entry: unknown[] }).entry.length
        : 0,
    });

    return webhookReply({ whatsappMessage });
  } catch (error) {
    console.error(error);
    return webhookError(
      error instanceof Error ? error.message : "Failed to process WhatsApp webhook",
      500,
    );
  }
};

async function safeAppendConversation(
  input: Parameters<typeof appendConversationMessages>[0],
): Promise<void> {
  try {
    await appendConversationMessages(input);
  } catch (error) {
    // Reply path should not fail solely because history persistence failed.
    console.error("Failed to persist WhatsApp conversation", error);
  }
}

async function safePutReplyBlock(
  quietPhoneE164: string,
  otherPhoneE164: string,
): Promise<void> {
  try {
    await putWhatsAppReplyBlock(quietPhoneE164, otherPhoneE164);
  } catch (error) {
    console.error("Failed to persist WhatsApp reply block", error);
  }
}
