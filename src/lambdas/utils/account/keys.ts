import { randomBytes } from "crypto";

export const PROFILE_SK = "PROFILE";
export const PHONE_SK = "ACCOUNT";
export const CONSENT_SK = "CONSENT";
export const ADDRESS_PREFIX = "ADDR#";
export const PRODUCT_PREFIX = "PROD#";
export const FAQ_PREFIX = "FAQ#";
export const CONVERSATION_PREFIX = "CONVERSATION#";
export const CONVERSATION_ENTITY = "CONVERSATION";
export const REPLY_BLOCK_PREFIX = "BLOCK#";
export const REPLY_BLOCK_ENTITY = "REPLY_BLOCK";
export const REPLY_BLOCK_SK = "ACTIVE";
/** Rolling window of inbound + outbound WhatsApp turns kept per conversation. */
export const MAX_CONVERSATION_MESSAGES = 6;
/** Privacy retention: Dynamo TTL deletes the row this many ms after creation. */
export const CONVERSATION_TTL_MS = 60 * 60 * 1000;
/** Auto-reply loop guard: quiet phone must not bot-reply to other phone. */
export const REPLY_BLOCK_TTL_MS = 60 * 60 * 1000;
/** Max new WhatsApp conversation threads per account per calendar month (UTC). */
export const MAX_CONVERSATIONS_PER_MONTH = 100;

export const PLANS_PK = "PLANS";
export const PLANS_SK = "PLANS";

export const MAX_FAQS = 10;
export const MAX_ADDRESSES = 50;
export const MAX_PRODUCT_PAGE = 50;
export const DEFAULT_PRODUCT_PAGE = 20;
export const MAX_IMAGE_URLS = 8;
export const MAX_SCHEDULE_WINDOWS = 28;

const ENTITY_ID = /^[0-9a-z]{8,12}-[0-9a-f]{12}$/;

export function createEntityId(now = Date.now()): string {
  const time = now.toString(36).padStart(8, "0");
  return `${time}-${randomBytes(6).toString("hex")}`;
}

export function isEntityId(value: string): boolean {
  return ENTITY_ID.test(value);
}

export function accountPk(accountId: string): string {
  return `ACC#${accountId}`;
}

export function phonePk(phone: string): string {
  return `PHONE#${phone}`;
}

export function addressSk(id: string): string {
  return `${ADDRESS_PREFIX}${id}`;
}

export function productSk(id: string): string {
  return `${PRODUCT_PREFIX}${id}`;
}

export function faqSk(id: string): string {
  return `${FAQ_PREFIX}${id}`;
}

/** One active WhatsApp thread per account + customer phone. */
export function conversationPk(accountId: string, customerPhoneE164: string): string {
  return `${CONVERSATION_PREFIX}${accountId}#${customerPhoneE164}`;
}

/**
 * Loop guard: `quietPhone` must not auto-reply when messaged by `otherPhone`
 * (e.g. after quietPhone messaged otherPhone as a customer).
 */
export function replyBlockPk(quietPhoneE164: string, otherPhoneE164: string): string {
  return `${REPLY_BLOCK_PREFIX}${quietPhoneE164}#${otherPhoneE164}`;
}
