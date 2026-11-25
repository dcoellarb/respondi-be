import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";
import {
  DAYS_OF_WEEK,
  DayOfWeek,
  PricePlan,
  PublicAddress,
  PublicProduct,
  PublicProfile,
  ScheduleWindow,
} from "../account/types";
import { WhatsAppAnswerContext } from "./answer-context";

/** Amazon Nova Pro — stronger reply writing than Nova Micro classifier. */
export const DEFAULT_ANSWER_MODEL_ID = "us.amazon.nova-pro-v1:0";

const SYSTEM_PROMPT = `You draft WhatsApp replies using ONLY the provided business context JSON.

Decide first whether you can answer from that JSON alone (plus recent conversation turns when provided — use them only for continuity, not as a source of new business facts).

If the customer’s ask cannot be answered from the JSON (missing facts — e.g. payments, parking, policies, amenities not listed), return:
{"answered":false,"reason":"<short why>"}
Do NOT write a customer-facing apology or message when answered is false. Never invent facts.

Schedule exception (important): when scheduleByService IS present and the customer asks about a day/time that has NO listed slots, that means the business/service is CLOSED then. Answer that they are closed — do NOT return answered:false for missing days. Only invent open hours that appear in scheduleByService.

If you CAN answer from the JSON, return:
{"answered":true,"reply":"<customer-facing WhatsApp text>"}

When answered is true, the reply must:
- Answer ONLY what was asked. No opening hours unless scheduleByService is present AND they asked about hours.
- Broad "more information" / what do you offer / help me learn about the business: give a short summary of products/services from the JSON (names + one-line each; prices only if clearly listed), then a CTA asking them to pick a more specific question (e.g. hours, a service, prices, location). Do NOT return answered:false just because the ask is vague when products (or profile) are present.
- Never invent or echo internal ids. Use human service names only.
- Never invent prices, addresses, products, plans, policies, payment methods, parking, or amenities.
- Prices: use priceDisplay; never treat priceMinor as major-unit money.
- Prefer plans[] for services; FAQs only from faqs[].
- Greeting: use "¡Hola!" / "Hi" / similar ONLY when firstTurn is true. If firstTurn is false, do NOT greet again — continue naturally (e.g. "Los sábados estamos cerrados…").
- Structure: (1) brief warm lead-in (greeting only on firstTurn), (2) clear facts, (3) short in-chat CTA. No contact-us / phone CTA.
- Match the customer’s language. Prefer under 900 characters. Light *bold* ok; no markdown headings.
- For scheduleByService: one service at a time; use daysLabel exactly; never widen open days; days not listed = closed; Friday mornings only when afternoon slots are missing.

Return ONLY that JSON object. No markdown fences, no extra keys, no preamble.`;

export type WhatsAppReplyResult =
  | { answered: true; text: string }
  | { answered: false; reason: string };

export interface ScheduleSlotSummary {
  days: DayOfWeek[];
  /** Collapsed consecutive day ranges, e.g. "monday–thursday" or "monday, friday". */
  daysLabel: string;
  start: string;
  end: string;
}

export interface ScheduleByServiceSummary {
  serviceKey: string;
  serviceLabel: string;
  slots: ScheduleSlotSummary[];
}

let client: BedrockRuntimeClient | undefined;

export function resetGenerateReplyClient(): void {
  client = undefined;
}

function bedrock(): BedrockRuntimeClient {
  if (!client) client = new BedrockRuntimeClient({});
  return client;
}

function answerModelId(): string {
  return process.env.BEDROCK_ANSWER_MODEL_ID?.trim() || DEFAULT_ANSWER_MODEL_ID;
}

/**
 * Drafts a WhatsApp reply from Dynamo context, or signals that facts are missing.
 */
export async function generateWhatsAppReply(input: {
  customerMessage: string;
  context: WhatsAppAnswerContext;
  sources: string[];
  intentReason: string;
  conversationHistory?: string;
  /** True when there is no prior Business outbound in this conversation. */
  firstTurn?: boolean;
}): Promise<WhatsAppReplyResult> {
  const includeSchedule = input.sources.includes("hours");
  const contextJson = JSON.stringify(
    compactContext(input.context, { includeSchedule }),
  );
  const history = input.conversationHistory?.trim();
  const firstTurn =
    typeof input.firstTurn === "boolean" ? input.firstTurn : !history;
  const userPrompt = [
    `Classifier reason: ${input.intentReason}`,
    `Data sources loaded: ${input.sources.join(", ") || "(none)"}`,
    `firstTurn: ${firstTurn}`,
    firstTurn
      ? "This is the first bot reply in the thread — a short greeting is ok."
      : "This is a follow-up — do NOT greet again (no ¡Hola!/Hi); continue the thread.",
    history ? `Recent conversation:\n${history.slice(0, 3000)}` : null,
    `Customer message: ${input.customerMessage.slice(0, 2000)}`,
    `Business context JSON: ${contextJson}`,
    includeSchedule
      ? "If they ask about a day with no slots in scheduleByService, answer that you are closed that day (answered:true)."
      : null,
    input.sources.includes("products")
      ? "If they asked broadly for more information / what you offer, summarize products/services briefly then CTA for a more specific question (answered:true)."
      : null,
    'Return JSON only: {"answered":true,"reply":"..."} or {"answered":false,"reason":"..."}.',
  ]
    .filter(Boolean)
    .join("\n");

  const response = await bedrock().send(
    new ConverseCommand({
      modelId: answerModelId(),
      system: [{ text: SYSTEM_PROMPT }],
      messages: [
        {
          role: "user",
          content: [{ text: userPrompt }],
        },
      ],
      inferenceConfig: {
        maxTokens: 700,
        temperature: 0.15,
      },
    }),
  );

  const text = response.output?.message?.content
    ?.map((part) => ("text" in part && typeof part.text === "string" ? part.text : ""))
    .join("")
    .trim();

  if (!text) {
    throw new Error("Bedrock returned an empty WhatsApp reply");
  }
  return parseWhatsAppReplyResult(text);
}

/** Exported for unit tests. */
export function parseWhatsAppReplyResult(raw: string): WhatsAppReplyResult {
  const jsonText = extractJsonObject(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error("Bedrock WhatsApp reply was not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Bedrock WhatsApp reply must be a JSON object");
  }
  const record = parsed as Record<string, unknown>;
  if (record.answered === false) {
    const reason =
      typeof record.reason === "string" && record.reason.trim()
        ? record.reason.trim().slice(0, 240)
        : "insufficient account data";
    return { answered: false, reason };
  }
  if (record.answered === true) {
    const reply =
      typeof record.reply === "string"
        ? record.reply.trim()
        : typeof record.text === "string"
          ? record.text.trim()
          : "";
    if (!reply) {
      throw new Error("Bedrock WhatsApp reply marked answered but reply text was empty");
    }
    return { answered: true, text: reply };
  }
  throw new Error("Bedrock WhatsApp reply missing answered boolean");
}

function extractJsonObject(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start >= 0 && end > start) return candidate.slice(start, end + 1);
  return candidate;
}

export interface CompactContextOptions {
  /** When false, omit scheduleByService so the model cannot dump hours unprompted. */
  includeSchedule?: boolean;
}

/** Shrink/enrich context so the model sees accurate money + schedule semantics. */
export function compactContext(
  context: WhatsAppAnswerContext,
  options: CompactContextOptions = {},
): Record<string, unknown> {
  const includeSchedule = options.includeSchedule === true;
  const productNames = new Map<string, string>();
  for (const product of context.products ?? []) {
    productNames.set(product.id, product.name);
  }

  const out: Record<string, unknown> = {
    accountId: context.accountId,
    notes: [
      "Answer only with facts present in this JSON for what the customer asked.",
      "If a needed detail is missing, return answered:false — never invent it.",
      "Never mention internal ids (product/address ids).",
      "priceMinor is minor currency units; always use priceDisplay when speaking to the customer.",
      ...(includeSchedule
        ? [
            "Use scheduleByService as the source of truth for opening hours.",
            "Each entry is one named service (or all_services). Describe services separately.",
            "Use daysLabel for day ranges; never add open days beyond days[].",
            "Days/times not listed in scheduleByService mean closed — say so; do not return answered:false.",
          ]
        : ["Opening hours are intentionally omitted — do not invent or add a schedule."]),
    ],
  };

  if (context.profile) {
    out.profile = compactProfile(context.profile, productNames, includeSchedule);
  } else if (context.profile === null) {
    out.profile = null;
  }
  if (context.products) {
    out.products = context.products.map(compactProduct);
  }
  if (context.addresses) {
    out.addresses = context.addresses.map((address) =>
      compactAddress(address, productNames, includeSchedule),
    );
  }
  if (context.faqs) {
    out.faqs = context.faqs.map((faq) => ({
      question: faq.question,
      answer: faq.answer,
      sortOrder: faq.sortOrder,
    }));
  }
  return out;
}

/**
 * Groups windows by service, then collapses identical start/end across days.
 * Shared (no productId) windows are merged into each named service when any
 * exist, so the model can describe one service at a time without blending.
 * Account-agnostic: works for any product-linked or general schedule.
 */
export function buildScheduleByService(
  hours: ScheduleWindow[],
  productNames: Map<string, string>,
): ScheduleByServiceSummary[] {
  const byService = new Map<string, ScheduleWindow[]>();
  for (const window of hours) {
    const key =
      typeof window.productId === "string" && window.productId.trim()
        ? window.productId.trim()
        : "";
    const list = byService.get(key) ?? [];
    list.push(window);
    byService.set(key, list);
  }

  const shared = byService.get("") ?? [];
  byService.delete("");

  // Skip product-linked windows we cannot name — never leak raw product ids.
  const namedKeys = [...byService.keys()]
    .filter((key) => productNames.has(key))
    .sort((left, right) => {
      const leftName = productNames.get(left) ?? left;
      const rightName = productNames.get(right) ?? right;
      return leftName.localeCompare(rightName);
    });

  // Prefer per-service rows with shared hours folded in; fall back to shared-only.
  const rows: Array<{ key: string; windows: ScheduleWindow[] }> =
    namedKeys.length > 0
      ? namedKeys.map((key) => ({
          key,
          windows: [...(byService.get(key) ?? []), ...shared],
        }))
      : shared.length > 0
        ? [{ key: "", windows: shared }]
        : [];

  return rows.map(({ key, windows }) => {
    const bySlot = new Map<string, DayOfWeek[]>();
    for (const window of windows) {
      const slotKey = `${window.start}|${window.end}`;
      const days = bySlot.get(slotKey) ?? [];
      if (!days.includes(window.dayOfWeek)) days.push(window.dayOfWeek);
      bySlot.set(slotKey, days);
    }

    const slots: ScheduleSlotSummary[] = [...bySlot.entries()]
      .map(([slotKey, days]) => {
        const [start, end] = slotKey.split("|");
        const sorted = sortDays(days);
        return {
          days: sorted,
          daysLabel: formatDaysLabel(sorted),
          start,
          end,
        };
      })
      .sort((left, right) => {
        const dayCmp = dayIndex(left.days[0]) - dayIndex(right.days[0]);
        if (dayCmp !== 0) return dayCmp;
        return left.start.localeCompare(right.start);
      });

    return {
      serviceKey: key || "all_services",
      serviceLabel: key ? productNames.get(key) ?? key : "all_services",
      slots,
    };
  });
}

/** Collapses consecutive weekdays into ranges for clearer model prompts. */
export function formatDaysLabel(days: DayOfWeek[]): string {
  if (days.length === 0) return "";
  const sorted = sortDays(days);
  const ranges: string[] = [];
  let rangeStart = sorted[0];
  let rangeEnd = sorted[0];

  for (let i = 1; i < sorted.length; i += 1) {
    const day = sorted[i];
    if (dayIndex(day) === dayIndex(rangeEnd) + 1) {
      rangeEnd = day;
      continue;
    }
    ranges.push(formatDayRange(rangeStart, rangeEnd));
    rangeStart = day;
    rangeEnd = day;
  }
  ranges.push(formatDayRange(rangeStart, rangeEnd));
  return ranges.join(", ");
}

function formatDayRange(start: DayOfWeek, end: DayOfWeek): string {
  if (start === end) return start;
  return `${start}–${end}`;
}

function compactProfile(
  profile: PublicProfile,
  productNames: Map<string, string>,
  includeSchedule: boolean,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    businessName: profile.businessName,
    phone: profile.phone,
    whatsappBusinessInUse: profile.whatsappBusinessInUse,
    contactName: profile.contactName,
    contactPhone: profile.contactPhone,
    scheduleMode: profile.scheduleMode,
  };
  if (includeSchedule) {
    out.scheduleByService = buildScheduleByService(profile.hours, productNames);
  }
  return out;
}

function compactAddress(
  address: PublicAddress,
  productNames: Map<string, string>,
  includeSchedule: boolean,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    label: address.label,
    line1: address.line1,
    line2: address.line2,
    city: address.city,
    region: address.region,
    postalCode: address.postalCode,
    country: address.country,
  };
  if (includeSchedule) {
    out.scheduleByService = buildScheduleByService(address.hours, productNames);
  }
  return out;
}

function compactProduct(product: PublicProduct): Record<string, unknown> {
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    kind: product.kind,
    priceMinor: product.priceMinor,
    priceDisplay: formatMoney(product.priceMinor, product.currency),
    currency: product.currency,
    priceRules: product.priceRules,
    pricingRules: product.pricingRules,
    plans: (product.plans ?? []).map((plan) => compactPlan(plan, product.currency)),
  };
}

function compactPlan(plan: PricePlan, currency: string): Record<string, unknown> {
  return {
    name: plan.name,
    priceMinor: plan.priceMinor,
    priceDisplay: formatMoney(plan.priceMinor, currency),
    rules: plan.rules,
  };
}

function sortDays(days: DayOfWeek[]): DayOfWeek[] {
  return [...days].sort((left, right) => dayIndex(left) - dayIndex(right));
}

function dayIndex(day: DayOfWeek): number {
  return DAYS_OF_WEEK.indexOf(day);
}

/** Exported for unit tests. priceMinor is always minor units (cents). */
export function formatMoney(priceMinor: number, currency: string): string {
  const major = priceMinor / 100;
  const display = Number.isInteger(major) ? String(major) : major.toFixed(2);
  return `${display} ${currency.toUpperCase()}`;
}
