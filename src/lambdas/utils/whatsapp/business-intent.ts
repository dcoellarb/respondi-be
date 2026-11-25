import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";

/**
 * Data slices needed to answer a business WhatsApp message.
 * Multi-label: one message can need several (e.g. products + addresses).
 */
export const BUSINESS_DATA_SOURCES = [
  "profile",
  "products",
  "addresses",
  "hours",
  "faqs",
] as const;

export type BusinessDataSource = (typeof BUSINESS_DATA_SOURCES)[number];

export interface BusinessIntentResult {
  businessRelated: boolean;
  /** Which account data to load. Empty when not business-related. */
  sources: BusinessDataSource[];
  reason: string;
}

const DEFAULT_MODEL_ID = "us.amazon.nova-micro-v1:0";
const SOURCE_SET = new Set<string>(BUSINESS_DATA_SOURCES);

const SYSTEM_PROMPT = `You classify inbound WhatsApp messages for a small-business assistant.

Step 1 — businessRelated:
true if the customer asks about the shop/service — products, prices, hours, booking, location, orders, support, availability, payments, policies, suitability for a service (e.g. pregnancy, age, beginners, injuries, men/women), differences between offerings, what to bring, or similar.
Also true for broad interest in the business: asking for more information, details, what you offer, how you can help, or "tell me more" — even when wrapped in a greeting (e.g. "buenas noches, me ayuda con más información?").
Personal details in a service question still count as businessRelated (e.g. "I'm pregnant, can I do Pilates?").
false ONLY for pure chit-chat / empty greetings with NO ask for info or help about the business (e.g. only "hola" / "buenas noches"), spam, jokes, or topics unrelated to this business.

Step 2 — sources (ONLY when businessRelated is true):
Return EVERY relevant data slice. A message can need more than one.
- "profile": business name, contact, WhatsApp/business phone, general account info
- "products": products or services, prices, plans, catalog, offerings; also for broad "more information" / what do you offer asks
- "addresses": physical locations / branches only (street, city, how to get there). Do NOT use this for opening hours.
- "hours": opening hours, schedule, when open/closed, available times
- "faqs": policies, what to bring, how to start, or other Q&A; use when the ask is business-related but does not clearly need the slices above

For broad "more information" / tell-me-about-the-business messages, prefer sources ["products"] (add "profile" only if they ask who you are / contact).
If businessRelated is false, sources must be [].
If businessRelated is true and nothing else fits, sources must be ["faqs"].

Reply with ONLY compact JSON:
{"businessRelated":true|false,"sources":["profile"|"products"|"addresses"|"hours"|"faqs",...],"reason":"<short>"}
No markdown, no extra keys. Deduplicate sources; keep array order as listed above when multiple apply.`;

let client: BedrockRuntimeClient | undefined;

export function resetBusinessIntentClient(): void {
  client = undefined;
}

function bedrock(): BedrockRuntimeClient {
  if (!client) client = new BedrockRuntimeClient({});
  return client;
}

function modelId(): string {
  return process.env.BEDROCK_MODEL_ID?.trim() || DEFAULT_MODEL_ID;
}

/**
 * One-shot Nova Micro classification: business filter + multi-label data routing.
 * Optional recent conversation turns help resolve short follow-ups ("and prices?").
 */
export async function classifyBusinessIntent(
  message: string,
  conversationHistory?: string,
): Promise<BusinessIntentResult> {
  const trimmed = message.trim();
  if (!trimmed) {
    return { businessRelated: false, sources: [], reason: "empty message" };
  }

  const history = conversationHistory?.trim();
  const userContent = [
    history ? `Recent conversation:\n${history.slice(0, 3000)}` : null,
    `Latest customer message: ${trimmed.slice(0, 2000)}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const response = await bedrock().send(
    new ConverseCommand({
      modelId: modelId(),
      system: [{ text: SYSTEM_PROMPT }],
      messages: [
        {
          role: "user",
          content: [{ text: userContent }],
        },
      ],
      inferenceConfig: {
        maxTokens: 160,
        temperature: 0,
      },
    }),
  );

  const text = response.output?.message?.content
    ?.map((part) => ("text" in part && typeof part.text === "string" ? part.text : ""))
    .join("")
    .trim();

  if (!text) {
    throw new Error("Bedrock returned an empty business-intent response");
  }

  return parseBusinessIntent(text);
}

export function parseBusinessIntent(raw: string): BusinessIntentResult {
  const jsonText = extractJsonObject(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error("Bedrock business-intent response was not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Bedrock business-intent response must be a JSON object");
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record.businessRelated !== "boolean") {
    throw new Error("Bedrock business-intent response missing businessRelated boolean");
  }

  const reason =
    typeof record.reason === "string" && record.reason.trim()
      ? record.reason.trim().slice(0, 240)
      : "unspecified";

  if (!record.businessRelated) {
    return { businessRelated: false, sources: [], reason };
  }

  const sources = normalizeSources(record.sources);
  return {
    businessRelated: true,
    sources: sources.length ? sources : ["faqs"],
    reason,
  };
}

function normalizeSources(value: unknown): BusinessDataSource[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<BusinessDataSource>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const key = entry.trim().toLowerCase();
    if (!SOURCE_SET.has(key)) continue;
    seen.add(key as BusinessDataSource);
  }
  return BUSINESS_DATA_SOURCES.filter((source) => seen.has(source));
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
