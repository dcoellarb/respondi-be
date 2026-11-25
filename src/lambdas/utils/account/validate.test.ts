import {
  applyProfilePatch,
  normalizePhone,
  parseProductWrite,
  parseProfileWrite,
} from "./validate";
import { PublicProfile } from "./types";

const profile: PublicProfile = {
  accountId: "user-1",
  email: "ada@example.com",
  businessName: "Ada Gym",
  phone: "+15551234567",
  contactName: "Ada Lovelace",
  contactPhone: null,
  scheduleMode: "per_address",
  hours: [],
  conversationsThisMonth: 0,
  conversationsMonth: "2026-01",
  conversationsMonthlyLimit: 100,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  plan: null,
};

describe("account validation", () => {
  it("normalizes a phone number to E.164", () => {
    expect(normalizePhone("+1 (555) 123-4567")).toBe("+15551234567");
    expect(normalizePhone("5551234567")).toBeNull();
  });

  it("requires business hours and rejects overlapping windows", () => {
    const missing = parseProfileWrite({
      businessName: "Ada Gym",
      phone: "+15551234567",
      contactName: "Ada Lovelace",
      scheduleMode: "business",
    });
    expect(missing.ok).toBe(false);

    const overlap = parseProfileWrite({
      businessName: "Ada Gym",
      phone: "+1 555 123 4567",
      contactName: "Ada Lovelace",
      scheduleMode: "business",
      hours: [
        { dayOfWeek: "monday", start: "09:00", end: "13:00" },
        { dayOfWeek: "monday", start: "12:00", end: "17:00" },
      ],
    });
    expect(overlap.ok).toBe(false);
    if (!overlap.ok) expect(overlap.code).toBe("OVERLAPPING_HOURS");
  });

  it("keeps touching windows and stores per-address hours on addresses", () => {
    const parsed = parseProfileWrite({
      businessName: "Ada Gym",
      phone: "+15551234567",
      contactName: "Ada Lovelace",
      scheduleMode: "business",
      hours: [
        { dayOfWeek: "monday", start: "09:00", end: "12:00" },
        { dayOfWeek: "monday", start: "12:00", end: "17:00" },
      ],
    });
    expect(parsed.ok).toBe(true);

    const onProfile = parseProfileWrite({
      businessName: "Ada Gym",
      phone: "+15551234567",
      contactName: "Ada Lovelace",
      scheduleMode: "per_address",
      hours: [{ dayOfWeek: "monday", start: "09:00", end: "17:00" }],
    });
    expect(onProfile.ok).toBe(false);
    if (!onProfile.ok) expect(onProfile.code).toBe("SCHEDULE_MODE_CONFLICT");
  });

  it("accepts productId on schedule windows including null", () => {
    const withId = parseProfileWrite({
      businessName: "Ada Gym",
      phone: "+15551234567",
      contactName: "Ada Lovelace",
      scheduleMode: "business",
      hours: [
        {
          dayOfWeek: "monday",
          start: "09:00",
          end: "17:00",
          productId: "abc12345-deadbeefcafe",
        },
        {
          dayOfWeek: "monday",
          start: "09:00",
          end: "12:00",
          productId: "other000-deadbeefcafe",
        },
        { dayOfWeek: "tuesday", start: "09:00", end: "17:00", productId: null },
      ],
    });
    expect(withId.ok).toBe(true);
    if (withId.ok) {
      expect(withId.value.hours[0].productId).toBe("abc12345-deadbeefcafe");
      // null productId is treated as "all services" and omitted from the window.
      expect(withId.value.hours[2].productId).toBeUndefined();
    }

    const emptyId = parseProfileWrite({
      businessName: "Ada Gym",
      phone: "+15551234567",
      contactName: "Ada Lovelace",
      scheduleMode: "business",
      hours: [{ dayOfWeek: "monday", start: "09:00", end: "17:00", productId: "  " }],
    });
    expect(emptyId.ok).toBe(false);
    if (!emptyId.ok) expect(emptyId.code).toBe("INVALID_HOURS");
  });

  it("rejects identity and unknown fields", () => {
    const parsed = parseProfileWrite({
      businessName: "Ada Gym",
      phone: "+15551234567",
      contactName: "Ada Lovelace",
      scheduleMode: "per_address",
      email: "other@example.com",
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.code).toBe("UNKNOWN_FIELD");
  });

  it("requires hours when switching the schedule onto the business", () => {
    const missing = applyProfilePatch(profile, { scheduleMode: "business" });
    expect(missing.ok).toBe(false);

    const switched = applyProfilePatch(profile, {
      scheduleMode: "business",
      hours: [{ dayOfWeek: "tuesday", start: "10:00", end: "14:00" }],
    });
    expect(switched.ok).toBe(true);
    if (switched.ok) expect(switched.value.hours).toHaveLength(1);
  });

  it("accepts service write fields and defaults legacy product writes", () => {
    const service = parseProductWrite({
      name: "Mensual",
      description: "Acceso al gym",
      kind: "service",
      priceMinor: 5000,
      pricingRules: "Inscripción anual aparte",
      plans: [
        { name: "Mensual", priceMinor: 5000, rules: "Congelación 1 vez/año" },
        { name: "Trimestral", priceMinor: 13500, rules: null },
      ],
      currency: "USD",
      imageUrls: [],
    });
    expect(service.ok).toBe(true);
    if (service.ok) {
      expect(service.value.kind).toBe("service");
      expect(service.value.plans).toHaveLength(2);
      expect(service.value.priceRules).toBeNull();
      expect(service.value.pricingRules).toBe("Inscripción anual aparte");
    }

    const legacy = parseProductWrite({
      name: "Day pass",
      description: null,
      priceMinor: 1500,
      currency: "usd",
      imageUrls: [],
    });
    expect(legacy.ok).toBe(true);
    if (legacy.ok) {
      expect(legacy.value.kind).toBe("service");
      expect(legacy.value.plans).toEqual([]);
      expect(legacy.value.priceRules).toBeNull();
      expect(legacy.value.pricingRules).toBeNull();
      expect(legacy.value.currency).toBe("USD");
    }
  });

  it("rejects a bad kind, fractional price, non-https image, and too many plans", () => {
    const kind = parseProductWrite({
      name: "Day pass",
      kind: "bundle",
      priceMinor: 1500,
      currency: "usd",
    });
    expect(kind.ok).toBe(false);
    if (!kind.ok) expect(kind.code).toBe("INVALID_FIELD");

    const price = parseProductWrite({
      name: "Day pass",
      priceMinor: 10.5,
      currency: "usd",
    });
    expect(price.ok).toBe(false);

    const image = parseProductWrite({
      name: "Day pass",
      priceMinor: 1500,
      currency: "usd",
      imageUrls: ["http://example.com/pass.png"],
    });
    expect(image.ok).toBe(false);

    const plans = parseProductWrite({
      name: "Day pass",
      priceMinor: 1500,
      currency: "usd",
      plans: Array.from({ length: 11 }, (_, index) => ({
        name: `Plan ${index}`,
        priceMinor: 1000,
      })),
    });
    expect(plans.ok).toBe(false);
    if (!plans.ok) expect(plans.code).toBe("INVALID_FIELD");
  });
});
