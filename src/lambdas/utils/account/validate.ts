import { MAX_IMAGE_URLS, MAX_SCHEDULE_WINDOWS } from "./keys";
import {
  AccountPlan,
  AddressPatch,
  AddressWrite,
  DAYS_OF_WEEK,
  DayOfWeek,
  FaqPatch,
  FaqWrite,
  FieldError,
  Parsed,
  PricePlan,
  ProductKind,
  ProductPatch,
  ProductWrite,
  ProfilePatch,
  ProfileWrite,
  PublicAddress,
  PublicFaq,
  PublicProduct,
  PublicProfile,
  ScheduleMode,
  ScheduleWindow,
} from "./types";

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const PHONE = /^\+[1-9]\d{7,14}$/;
const MAX_PRICE_MINOR = 100_000_000_000;
const MAX_PLANS = 10;
const MAX_PLAN_NAME = 80;
const MAX_RULES = 2000;

const PROFILE_FIELDS = [
  "businessName",
  "phone",
  // Kept so old clients sending it are not rejected by unknownFields; the value is ignored.
  "whatsappBusinessInUse",
  "contactName",
  "contactPhone",
  "scheduleMode",
  "hours",
  "plan",
] as const;

const ADDRESS_FIELDS = [
  "label",
  "line1",
  "line2",
  "city",
  "region",
  "postalCode",
  "country",
  "hours",
] as const;

const PRODUCT_FIELDS = [
  "name",
  "description",
  "kind",
  "priceMinor",
  "priceRules",
  "pricingRules",
  "plans",
  "currency",
  "imageUrls",
] as const;

const FAQ_FIELDS = ["question", "answer", "sortOrder"] as const;

export function normalizePhone(value: string): string | null {
  const compact = value.trim().replace(/[\s().-]/g, "");
  return PHONE.test(compact) ? compact : null;
}

export function parseProfileWrite(raw: Record<string, unknown>): Parsed<ProfileWrite> {
  const unknown = unknownFields(raw, PROFILE_FIELDS);
  if (unknown) return unknown;

  const businessName = parseRequiredText(raw.businessName, "businessName", 120);
  if (!businessName.ok) return businessName;
  const phone = parsePhone(raw.phone);
  if (!phone.ok) return phone;
  const contactName = parseRequiredText(raw.contactName, "contactName", 120);
  if (!contactName.ok) return contactName;
  const contactPhone = parseOptionalPhone(raw.contactPhone, true);
  if (!contactPhone.ok) return contactPhone;
  const scheduleMode = parseScheduleMode(raw.scheduleMode);
  if (!scheduleMode.ok) return scheduleMode;
  const hours = hoursForMode(scheduleMode.value, raw, true);
  if (!hours.ok) return hours;

  return {
    ok: true,
    value: {
      businessName: businessName.value,
      phone: phone.value,
      contactName: contactName.value,
      contactPhone: contactPhone.value,
      scheduleMode: scheduleMode.value,
      hours: hours.value,
    },
  };
}

export function parseProfilePatch(raw: Record<string, unknown>): Parsed<ProfilePatch> {
  const unknown = unknownFields(raw, PROFILE_FIELDS);
  if (unknown) return unknown;
  if (!hasAny(raw, PROFILE_FIELDS)) return atLeastOneField();

  const patch: ProfilePatch = {};
  if (has(raw, "businessName")) {
    const businessName = parseRequiredText(raw.businessName, "businessName", 120);
    if (!businessName.ok) return businessName;
    patch.businessName = businessName.value;
  }
  if (has(raw, "phone")) {
    const phone = parsePhone(raw.phone);
    if (!phone.ok) return phone;
    patch.phone = phone.value;
  }
  if (has(raw, "contactName")) {
    const contactName = parseRequiredText(raw.contactName, "contactName", 120);
    if (!contactName.ok) return contactName;
    patch.contactName = contactName.value;
  }
  if (has(raw, "contactPhone")) {
    const contactPhone = parseOptionalPhone(raw.contactPhone, true);
    if (!contactPhone.ok) return contactPhone;
    patch.contactPhone = contactPhone.value;
  }
  if (has(raw, "scheduleMode")) {
    const scheduleMode = parseScheduleMode(raw.scheduleMode);
    if (!scheduleMode.ok) return scheduleMode;
    patch.scheduleMode = scheduleMode.value;
  }
  if (has(raw, "hours")) {
    const hours = parseHours(raw.hours);
    if (!hours.ok) return hours;
    patch.hours = hours.value;
  }
  if (has(raw, "plan")) {
    if (raw.plan === null) {
      patch.plan = null;
    } else {
      const plan = parsePlan(raw.plan);
      if (!plan.ok) return plan;
      patch.plan = plan.value;
    }
  }
  return { ok: true, value: patch };
}

export function applyProfilePatch(
  current: PublicProfile,
  patch: ProfilePatch,
): Parsed<ProfileWrite> {
  const scheduleMode = patch.scheduleMode ?? current.scheduleMode;
  if (scheduleMode === "per_address" && patch.hours && patch.hours.length > 0) {
    return fail(
      "Hours belong on each address when scheduleMode is per_address",
      "SCHEDULE_MODE_CONFLICT",
    );
  }

  let hours: ScheduleWindow[];
  if (scheduleMode === "per_address") {
    hours = [];
  } else if (patch.hours) {
    hours = patch.hours;
  } else if (current.scheduleMode === "business") {
    hours = current.hours;
  } else {
    return fail("hours is required when scheduleMode is business", "MISSING_HOURS", {
      missingFields: ["hours"],
    });
  }

  return {
    ok: true,
    value: {
      businessName: patch.businessName ?? current.businessName,
      phone: patch.phone ?? current.phone,
      contactName: patch.contactName ?? current.contactName,
      contactPhone:
        patch.contactPhone !== undefined ? patch.contactPhone : current.contactPhone,
      scheduleMode,
      hours,
      plan: patch.plan !== undefined ? patch.plan : (current.plan ?? undefined),
    },
  };
}

export function parseAddressWrite(raw: Record<string, unknown>): Parsed<AddressWrite> {
  const unknown = unknownFields(raw, ADDRESS_FIELDS);
  if (unknown) return unknown;
  return readAddress(raw, true);
}

export function parseAddressPatch(raw: Record<string, unknown>): Parsed<AddressPatch> {
  const unknown = unknownFields(raw, ADDRESS_FIELDS);
  if (unknown) return unknown;
  if (!hasAny(raw, ADDRESS_FIELDS)) return atLeastOneField();

  const patch: AddressPatch = {};
  if (has(raw, "label")) {
    const label = parseOptionalText(raw.label, "label", 80);
    if (!label.ok) return label;
    patch.label = label.value;
  }
  if (has(raw, "line1")) {
    const line1 = parseRequiredText(raw.line1, "line1", 200);
    if (!line1.ok) return line1;
    patch.line1 = line1.value;
  }
  if (has(raw, "line2")) {
    const line2 = parseOptionalText(raw.line2, "line2", 200);
    if (!line2.ok) return line2;
    patch.line2 = line2.value;
  }
  if (has(raw, "city")) {
    const city = parseRequiredText(raw.city, "city", 100);
    if (!city.ok) return city;
    patch.city = city.value;
  }
  if (has(raw, "region")) {
    const region = parseOptionalText(raw.region, "region", 80);
    if (!region.ok) return region;
    patch.region = region.value;
  }
  if (has(raw, "postalCode")) {
    const postalCode = parseOptionalText(raw.postalCode, "postalCode", 20);
    if (!postalCode.ok) return postalCode;
    patch.postalCode = postalCode.value;
  }
  if (has(raw, "country")) {
    const country = parseCountry(raw.country);
    if (!country.ok) return country;
    patch.country = country.value;
  }
  if (has(raw, "hours")) {
    const hours = parseHours(raw.hours);
    if (!hours.ok) return hours;
    patch.hours = hours.value;
  }
  return { ok: true, value: patch };
}

export function applyAddressPatch(
  current: PublicAddress,
  patch: AddressPatch,
): AddressWrite {
  return {
    label: patch.label !== undefined ? patch.label : current.label,
    line1: patch.line1 ?? current.line1,
    line2: patch.line2 !== undefined ? patch.line2 : current.line2,
    city: patch.city ?? current.city,
    region: patch.region !== undefined ? patch.region : current.region,
    postalCode: patch.postalCode !== undefined ? patch.postalCode : current.postalCode,
    country: patch.country ?? current.country,
    hours: patch.hours ?? current.hours,
  };
}

export function parseProductWrite(raw: Record<string, unknown>): Parsed<ProductWrite> {
  const unknown = unknownFields(raw, PRODUCT_FIELDS);
  if (unknown) return unknown;
  return readProduct(raw, true);
}

export function parseProductPatch(raw: Record<string, unknown>): Parsed<ProductPatch> {
  const unknown = unknownFields(raw, PRODUCT_FIELDS);
  if (unknown) return unknown;
  if (!hasAny(raw, PRODUCT_FIELDS)) return atLeastOneField();

  const patch: ProductPatch = {};
  if (has(raw, "name")) {
    const name = parseRequiredText(raw.name, "name", 160);
    if (!name.ok) return name;
    patch.name = name.value;
  }
  if (has(raw, "description")) {
    const description = parseOptionalText(raw.description, "description", 4000);
    if (!description.ok) return description;
    patch.description = description.value;
  }
  if (has(raw, "kind")) {
    const kind = parseProductKind(raw.kind);
    if (!kind.ok) return kind;
    patch.kind = kind.value;
  }
  if (has(raw, "priceMinor")) {
    const priceMinor = parsePrice(raw.priceMinor);
    if (!priceMinor.ok) return priceMinor;
    patch.priceMinor = priceMinor.value;
  }
  if (has(raw, "priceRules")) {
    const priceRules = parseOptionalText(raw.priceRules, "priceRules", MAX_RULES);
    if (!priceRules.ok) return priceRules;
    patch.priceRules = priceRules.value;
  }
  if (has(raw, "pricingRules")) {
    const pricingRules = parseOptionalText(
      raw.pricingRules,
      "pricingRules",
      MAX_RULES,
    );
    if (!pricingRules.ok) return pricingRules;
    patch.pricingRules = pricingRules.value;
  }
  if (has(raw, "plans")) {
    const plans = parsePricePlans(raw.plans);
    if (!plans.ok) return plans;
    patch.plans = plans.value;
  }
  if (has(raw, "currency")) {
    const currency = parseCurrency(raw.currency);
    if (!currency.ok) return currency;
    patch.currency = currency.value;
  }
  if (has(raw, "imageUrls")) {
    const imageUrls = parseImageUrls(raw.imageUrls);
    if (!imageUrls.ok) return imageUrls;
    patch.imageUrls = imageUrls.value;
  }
  return { ok: true, value: patch };
}

export function applyProductPatch(
  current: PublicProduct,
  patch: ProductPatch,
): ProductWrite {
  return {
    name: patch.name ?? current.name,
    description: patch.description !== undefined ? patch.description : current.description,
    kind: patch.kind ?? current.kind ?? "service",
    priceMinor: patch.priceMinor ?? current.priceMinor,
    priceRules:
      patch.priceRules !== undefined ? patch.priceRules : (current.priceRules ?? null),
    pricingRules:
      patch.pricingRules !== undefined
        ? patch.pricingRules
        : (current.pricingRules ?? null),
    plans: patch.plans ?? current.plans ?? [],
    currency: patch.currency ?? current.currency,
    imageUrls: patch.imageUrls ?? current.imageUrls,
  };
}

export function parseFaqWrite(
  raw: Record<string, unknown>,
  requireSortOrder: boolean,
): Parsed<FaqWrite> {
  const unknown = unknownFields(raw, FAQ_FIELDS);
  if (unknown) return unknown;

  const question = parseRequiredText(raw.question, "question", 500);
  if (!question.ok) return question;
  const answer = parseRequiredText(raw.answer, "answer", 4000);
  if (!answer.ok) return answer;

  let sortOrder: number | undefined;
  if (has(raw, "sortOrder") || requireSortOrder) {
    const parsed = parseSortOrder(raw.sortOrder);
    if (!parsed.ok) return parsed;
    sortOrder = parsed.value;
  }

  return {
    ok: true,
    value: { question: question.value, answer: answer.value, sortOrder },
  };
}

export function parseFaqPatch(raw: Record<string, unknown>): Parsed<FaqPatch> {
  const unknown = unknownFields(raw, FAQ_FIELDS);
  if (unknown) return unknown;
  if (!hasAny(raw, FAQ_FIELDS)) return atLeastOneField();

  const patch: FaqPatch = {};
  if (has(raw, "question")) {
    const question = parseRequiredText(raw.question, "question", 500);
    if (!question.ok) return question;
    patch.question = question.value;
  }
  if (has(raw, "answer")) {
    const answer = parseRequiredText(raw.answer, "answer", 4000);
    if (!answer.ok) return answer;
    patch.answer = answer.value;
  }
  if (has(raw, "sortOrder")) {
    const sortOrder = parseSortOrder(raw.sortOrder);
    if (!sortOrder.ok) return sortOrder;
    patch.sortOrder = sortOrder.value;
  }
  return { ok: true, value: patch };
}

export function applyFaqPatch(current: PublicFaq, patch: FaqPatch): FaqWrite {
  return {
    question: patch.question ?? current.question,
    answer: patch.answer ?? current.answer,
    sortOrder: patch.sortOrder ?? current.sortOrder,
  };
}

export function parseProductPage(
  query: Record<string, string | undefined> | null,
): Parsed<{ limit: number; cursor?: string }> {
  const source = query ?? {};
  const unknown = Object.keys(source).filter((key) => key !== "limit" && key !== "cursor");
  if (unknown.length) {
    return fail("Unknown query parameters", "UNKNOWN_FIELD", { fields: unknown });
  }

  let limit = 20;
  if (source.limit !== undefined) {
    if (!/^\d+$/.test(source.limit)) {
      return fail("limit must be a positive integer", "INVALID_LIMIT");
    }
    limit = Number(source.limit);
    if (limit < 1 || limit > 50) {
      return fail("limit must be between 1 and 50", "INVALID_LIMIT");
    }
  }

  const cursor = source.cursor?.trim();
  if (source.cursor !== undefined && !cursor) {
    return fail("cursor is invalid", "INVALID_CURSOR");
  }
  return { ok: true, value: { limit, cursor } };
}

function readAddress(
  raw: Record<string, unknown>,
  hoursDefaultEmpty: boolean,
): Parsed<AddressWrite> {
  const label = parseOptionalText(raw.label, "label", 80);
  if (!label.ok) return label;
  const line1 = parseRequiredText(raw.line1, "line1", 200);
  if (!line1.ok) return line1;
  const line2 = parseOptionalText(raw.line2, "line2", 200);
  if (!line2.ok) return line2;
  const city = parseRequiredText(raw.city, "city", 100);
  if (!city.ok) return city;
  const region = parseOptionalText(raw.region, "region", 80);
  if (!region.ok) return region;
  const postalCode = parseOptionalText(raw.postalCode, "postalCode", 20);
  if (!postalCode.ok) return postalCode;
  const country = parseCountry(raw.country);
  if (!country.ok) return country;
  const hours = has(raw, "hours")
    ? parseHours(raw.hours)
    : hoursDefaultEmpty
      ? { ok: true as const, value: [] }
      : fail("hours is required", "MISSING_HOURS", { missingFields: ["hours"] });
  if (!hours.ok) return hours;

  return {
    ok: true,
    value: {
      label: label.value,
      line1: line1.value,
      line2: line2.value,
      city: city.value,
      region: region.value,
      postalCode: postalCode.value,
      country: country.value,
      hours: hours.value,
    },
  };
}

function readProduct(raw: Record<string, unknown>, requireImages: boolean): Parsed<ProductWrite> {
  const name = parseRequiredText(raw.name, "name", 160);
  if (!name.ok) return name;
  const description = parseOptionalText(raw.description, "description", 4000);
  if (!description.ok) return description;
  const kind = has(raw, "kind")
    ? parseProductKind(raw.kind)
    : { ok: true as const, value: "service" as ProductKind };
  if (!kind.ok) return kind;
  const priceMinor = parsePrice(raw.priceMinor);
  if (!priceMinor.ok) return priceMinor;
  const priceRules = has(raw, "priceRules")
    ? parseOptionalText(raw.priceRules, "priceRules", MAX_RULES)
    : { ok: true as const, value: null as string | null };
  if (!priceRules.ok) return priceRules;
  const pricingRules = has(raw, "pricingRules")
    ? parseOptionalText(raw.pricingRules, "pricingRules", MAX_RULES)
    : { ok: true as const, value: null as string | null };
  if (!pricingRules.ok) return pricingRules;
  const plans = has(raw, "plans")
    ? parsePricePlans(raw.plans)
    : { ok: true as const, value: [] as PricePlan[] };
  if (!plans.ok) return plans;
  const currency = parseCurrency(raw.currency);
  if (!currency.ok) return currency;
  const imageUrls = has(raw, "imageUrls")
    ? parseImageUrls(raw.imageUrls)
    : requireImages
      ? { ok: true as const, value: [] as string[] }
      : fail("imageUrls is required", "MISSING_REQUIRED_FIELDS", {
          missingFields: ["imageUrls"],
        });
  if (!imageUrls.ok) return imageUrls;

  return {
    ok: true,
    value: {
      name: name.value,
      description: description.value,
      kind: kind.value,
      priceMinor: priceMinor.value,
      priceRules: priceRules.value,
      pricingRules: pricingRules.value,
      plans: plans.value,
      currency: currency.value,
      imageUrls: imageUrls.value,
    },
  };
}

function parseProductKind(value: unknown): Parsed<ProductKind> {
  if (value === "product" || value === "service") {
    return { ok: true, value };
  }
  return fail("kind must be product or service", "INVALID_FIELD", { field: "kind" });
}

function parsePricePlans(value: unknown): Parsed<PricePlan[]> {
  if (!Array.isArray(value)) {
    return fail("plans must be an array", "INVALID_FIELD", { field: "plans" });
  }
  if (value.length > MAX_PLANS) {
    return fail(`plans can include at most ${MAX_PLANS} entries`, "INVALID_FIELD", {
      field: "plans",
    });
  }
  const plans: PricePlan[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return fail("each plan must be an object", "INVALID_FIELD", { field: "plans" });
    }
    const raw = entry as Record<string, unknown>;
    const unknown = unknownFields(raw, ["name", "priceMinor", "rules"]);
    if (unknown) return unknown;
    const name = parseRequiredText(raw.name, "plans.name", MAX_PLAN_NAME);
    if (!name.ok) return name;
    const priceMinor = parsePrice(raw.priceMinor);
    if (!priceMinor.ok) return priceMinor;
    const rules = has(raw, "rules")
      ? parseOptionalText(raw.rules, "plans.rules", MAX_RULES)
      : { ok: true as const, value: null as string | null };
    if (!rules.ok) return rules;
    plans.push({
      name: name.value,
      priceMinor: priceMinor.value,
      rules: rules.value,
    });
  }
  return { ok: true, value: plans };
}

function parsePlan(value: unknown): Parsed<AccountPlan> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fail("plan must be an object", "INVALID_FIELD", { field: "plan" });
  }
  const raw = value as Record<string, unknown>;
  const allowed = [
    "name",
    "subtitle",
    "messagesCap",
    "addressesCap",
    "servicesCap",
    "productsCap",
    "faqsCap",
    "price",
    "frequency",
  ];
  const extra = Object.keys(raw).filter((k) => !allowed.includes(k));
  if (extra.length) return fail("Unknown fields in plan", "UNKNOWN_FIELD", { fields: extra });

  const name = parseRequiredText(raw.name, "plan.name", 80);
  if (!name.ok) return name;

  const subtitle = parseRequiredText(raw.subtitle, "plan.subtitle", 120);
  if (!subtitle.ok) return subtitle;

  for (const cap of [
    "messagesCap",
    "addressesCap",
    "servicesCap",
    "productsCap",
    "faqsCap",
  ] as const) {
    const v = raw[cap];
    if (v !== "unlimited") {
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
        return fail(
          `plan.${cap} must be a non-negative integer or "unlimited"`,
          "INVALID_FIELD",
          { field: `plan.${cap}` },
        );
      }
    }
  }

  if (typeof raw.price !== "number" || raw.price < 0) {
    return fail("plan.price must be a non-negative number", "INVALID_FIELD", {
      field: "plan.price",
    });
  }

  if (raw.frequency !== "monthly" && raw.frequency !== "annual") {
    return fail("plan.frequency must be monthly or annual", "INVALID_FIELD", {
      field: "plan.frequency",
    });
  }

  return {
    ok: true,
    value: {
      name: name.value,
      subtitle: subtitle.value,
      messagesCap: raw.messagesCap as number | "unlimited",
      addressesCap: raw.addressesCap as number | "unlimited",
      servicesCap: raw.servicesCap as number | "unlimited",
      productsCap: raw.productsCap as number | "unlimited",
      faqsCap: raw.faqsCap as number | "unlimited",
      price: raw.price as number,
      frequency: raw.frequency,
    },
  };
}

function hoursForMode(
  mode: ScheduleMode,
  raw: Record<string, unknown>,
  creating: boolean,
): Parsed<ScheduleWindow[]> {
  if (mode === "per_address") {
    if (has(raw, "hours")) {
      const hours = parseHours(raw.hours);
      if (!hours.ok) return hours;
      if (hours.value.length > 0) {
        return fail(
          "Hours belong on each address when scheduleMode is per_address",
          "SCHEDULE_MODE_CONFLICT",
        );
      }
    }
    return { ok: true, value: [] };
  }

  if (!has(raw, "hours")) {
    if (!creating) return { ok: true, value: [] };
    return fail("hours is required when scheduleMode is business", "MISSING_HOURS", {
      missingFields: ["hours"],
    });
  }
  return parseHours(raw.hours);
}

function parseHours(value: unknown): Parsed<ScheduleWindow[]> {
  if (!Array.isArray(value)) return fail("hours must be an array", "INVALID_HOURS");
  if (value.length > MAX_SCHEDULE_WINDOWS) {
    return fail(`hours can include at most ${MAX_SCHEDULE_WINDOWS} windows`, "INVALID_HOURS");
  }

  const windows: ScheduleWindow[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return fail("Each hours entry must be an object", "INVALID_HOURS");
    }
    const item = entry as Record<string, unknown>;
    const extra = unknownFields(item, ["dayOfWeek", "start", "end", "productId"]);
    if (extra) return extra;
    if (
      typeof item.dayOfWeek !== "string" ||
      !DAYS_OF_WEEK.includes(item.dayOfWeek as DayOfWeek)
    ) {
      return fail("dayOfWeek must be a day name from monday through sunday", "INVALID_HOURS");
    }
    if (typeof item.start !== "string" || !TIME.test(item.start)) {
      return fail("start must be HH:mm", "INVALID_HOURS");
    }
    if (typeof item.end !== "string" || !TIME.test(item.end)) {
      return fail("end must be HH:mm", "INVALID_HOURS");
    }
    if (item.end <= item.start) {
      return fail("end must be after start on the same day", "INVALID_HOURS");
    }
    const productId = parseScheduleProductId(item);
    if (!productId.ok) return productId;
    const window: ScheduleWindow = {
      dayOfWeek: item.dayOfWeek as DayOfWeek,
      start: item.start,
      end: item.end,
    };
    // Omit null/empty productId so Dynamo never stores nested NULL on hour maps.
    if (productId.value) {
      window.productId = productId.value;
    }
    windows.push(window);
  }

  // Overlap only within the same day + productId scope (null/omitted share one scope).
  const byScope = new Map<string, ScheduleWindow[]>();
  for (const window of windows) {
    const scope = `${window.dayOfWeek}::${window.productId ?? ""}`;
    const list = byScope.get(scope) ?? [];
    list.push(window);
    byScope.set(scope, list);
  }
  for (const list of byScope.values()) {
    list.sort((left, right) => left.start.localeCompare(right.start));
    for (let index = 1; index < list.length; index += 1) {
      if (list[index].start < list[index - 1].end) {
        return fail("Schedule windows on the same day overlap", "OVERLAPPING_HOURS");
      }
    }
  }
  return { ok: true, value: windows };
}

function parseScheduleProductId(
  item: Record<string, unknown>,
): Parsed<string | null> {
  if (!has(item, "productId") || item.productId === undefined) {
    return { ok: true, value: null };
  }
  if (item.productId === null) return { ok: true, value: null };
  if (typeof item.productId !== "string") {
    return fail("hours.productId must be a string or null", "INVALID_HOURS", {
      field: "productId",
    });
  }
  const trimmed = item.productId.trim();
  if (!trimmed) {
    return fail("hours.productId must be a non-empty string when set", "INVALID_HOURS", {
      field: "productId",
    });
  }
  return { ok: true, value: trimmed };
}

function parsePhone(value: unknown): Parsed<string> {
  if (typeof value !== "string") return fail("phone must be a string", "INVALID_PHONE");
  const phone = normalizePhone(value);
  if (!phone) {
    return fail("phone must be an E.164 number, for example +15551234567", "INVALID_PHONE");
  }
  return { ok: true, value: phone };
}

function parseOptionalPhone(value: unknown, allowMissing: boolean): Parsed<string | null> {
  if (value === undefined && allowMissing) return { ok: true, value: null };
  if (value === undefined || value === null || value === "") return { ok: true, value: null };
  if (typeof value !== "string") {
    return fail("contactPhone must be a string", "INVALID_PHONE");
  }
  const phone = normalizePhone(value);
  if (!phone) {
    return fail(
      "contactPhone must be an E.164 number, for example +15551234567",
      "INVALID_PHONE",
    );
  }
  return { ok: true, value: phone };
}

function parseScheduleMode(value: unknown): Parsed<ScheduleMode> {
  if (value !== "business" && value !== "per_address") {
    return fail("scheduleMode must be business or per_address", "INVALID_SCHEDULE_MODE");
  }
  return { ok: true, value };
}

function parseBoolean(value: unknown, field: string): Parsed<boolean> {
  if (typeof value !== "boolean") {
    return fail(`${field} must be a boolean`, "INVALID_FIELD", { field });
  }
  return { ok: true, value };
}

function parseCountry(value: unknown): Parsed<string> {
  if (typeof value !== "string" || !/^[A-Za-z]{2}$/.test(value.trim())) {
    return fail("country must be a 2-letter country code", "INVALID_COUNTRY");
  }
  return { ok: true, value: value.trim().toUpperCase() };
}

function parseCurrency(value: unknown): Parsed<string> {
  if (typeof value !== "string" || !/^[A-Za-z]{3}$/.test(value.trim())) {
    return fail("currency must be a 3-letter currency code", "INVALID_CURRENCY");
  }
  return { ok: true, value: value.trim().toUpperCase() };
}

function parsePrice(value: unknown): Parsed<number> {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > MAX_PRICE_MINOR
  ) {
    return fail(
      "priceMinor must be a non-negative integer in minor currency units",
      "INVALID_PRICE",
    );
  }
  return { ok: true, value };
}

function parseSortOrder(value: unknown): Parsed<number> {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 10000) {
    return fail("sortOrder must be an integer from 0 to 10000", "INVALID_SORT_ORDER");
  }
  return { ok: true, value };
}

function parseImageUrls(value: unknown): Parsed<string[]> {
  if (!Array.isArray(value)) return fail("imageUrls must be an array", "INVALID_IMAGE_URL");
  if (value.length > MAX_IMAGE_URLS) {
    return fail(`imageUrls can include at most ${MAX_IMAGE_URLS} URLs`, "INVALID_IMAGE_URL");
  }
  const urls: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !isHttpsUrl(entry.trim())) {
      return fail("imageUrls must be https URLs", "INVALID_IMAGE_URL");
    }
    urls.push(entry.trim());
  }
  return { ok: true, value: urls };
}

function isHttpsUrl(value: string): boolean {
  if (!value || value.length > 2000) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function parseRequiredText(value: unknown, field: string, max: number): Parsed<string> {
  const parsed = parseOptionalText(value, field, max);
  if (!parsed.ok) return parsed;
  if (!parsed.value) {
    return fail(`${field} is required`, "MISSING_REQUIRED_FIELDS", { missingFields: [field] });
  }
  return { ok: true, value: parsed.value };
}

function parseOptionalText(value: unknown, field: string, max: number): Parsed<string | null> {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== "string") {
    return fail(`${field} must be a string`, "INVALID_FIELD", { field });
  }
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: null };
  if (trimmed.length > max) {
    return fail(`${field} is too long`, "INVALID_FIELD", { field, maxLength: max });
  }
  return { ok: true, value: trimmed };
}

function unknownFields(
  raw: Record<string, unknown>,
  allowed: readonly string[],
): FieldError | null {
  const fields = Object.keys(raw).filter((key) => !allowed.includes(key));
  if (!fields.length) return null;
  return fail("Unknown fields", "UNKNOWN_FIELD", { fields });
}

function has(raw: Record<string, unknown>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(raw, field);
}

function hasAny(raw: Record<string, unknown>, fields: readonly string[]): boolean {
  return fields.some((field) => has(raw, field));
}

function atLeastOneField(): FieldError {
  return fail("At least one field is required", "MISSING_REQUIRED_FIELDS");
}

function fail(
  error: string,
  code: string,
  details?: Record<string, unknown>,
): FieldError {
  return { ok: false, error, code, details };
}
