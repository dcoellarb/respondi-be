import { AccountStore } from "../account/store";
import { PublicAddress, PublicFaq, PublicProduct, PublicProfile } from "../account/types";
import { loadAnswerContext, summarizeAnswerContext } from "./answer-context";

const profile: PublicProfile = {
  accountId: "user-1",
  email: "ada@example.com",
  businessName: "Ada Gym",
  phone: "+15551234567",
  whatsappBusinessInUse: true,
  contactName: "Ada",
  contactPhone: null,
  scheduleMode: "business",
  hours: [{ dayOfWeek: "monday", start: "09:00", end: "17:00" }],
  conversationsThisMonth: 0,
  conversationsMonth: "2026-01",
  conversationsMonthlyLimit: 100,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const product: PublicProduct = {
  id: "prod-1",
  name: "Mensual",
  description: null,
  kind: "service",
  priceMinor: 5000,
  priceRules: null,
  pricingRules: null,
  plans: [],
  currency: "USD",
  imageUrls: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const address: PublicAddress = {
  id: "addr-1",
  label: "Downtown",
  line1: "1 Main",
  line2: null,
  city: "Quito",
  region: null,
  postalCode: null,
  country: "EC",
  hours: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const faq: PublicFaq = {
  id: "faq-1",
  question: "Parking?",
  answer: "Street parking.",
  sortOrder: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("loadAnswerContext", () => {
  it("fetches only the requested sources in parallel", async () => {
    const store = {
      getProfile: jest.fn().mockResolvedValue(profile),
      listProducts: jest.fn().mockResolvedValue({ items: [product], nextCursor: null }),
      listAddresses: jest.fn().mockResolvedValue([address]),
      listFaqs: jest.fn().mockResolvedValue([faq]),
    } as unknown as AccountStore;

    const context = await loadAnswerContext(store, "user-1", ["products", "faqs"]);

    expect(store.getProfile).not.toHaveBeenCalled();
    expect(store.listAddresses).not.toHaveBeenCalled();
    expect(store.listProducts).toHaveBeenCalledWith("user-1", { limit: 50 });
    expect(store.listFaqs).toHaveBeenCalledWith("user-1");
    expect(context).toEqual({
      accountId: "user-1",
      products: [product],
      faqs: [faq],
    });
    expect(summarizeAnswerContext(context)).toEqual({
      profile: false,
      products: 1,
      addresses: null,
      faqs: 1,
    });
  });

  it("loads profile with addresses for location asks (no products)", async () => {
    const store = {
      getProfile: jest.fn().mockResolvedValue(profile),
      listProducts: jest.fn(),
      listAddresses: jest.fn().mockResolvedValue([address]),
      listFaqs: jest.fn(),
    } as unknown as AccountStore;

    const context = await loadAnswerContext(store, "user-1", ["addresses"]);

    expect(store.getProfile).toHaveBeenCalledWith("user-1");
    expect(store.listAddresses).toHaveBeenCalledWith("user-1");
    expect(store.listProducts).not.toHaveBeenCalled();
    expect(context.profile).toEqual(profile);
    expect(context.addresses).toEqual([address]);
  });

  it("loads profile, addresses, and products when hours are requested", async () => {
    const store = {
      getProfile: jest.fn().mockResolvedValue(profile),
      listProducts: jest.fn().mockResolvedValue({ items: [product], nextCursor: null }),
      listAddresses: jest.fn().mockResolvedValue([address]),
      listFaqs: jest.fn(),
    } as unknown as AccountStore;

    const context = await loadAnswerContext(store, "user-1", ["hours"]);

    expect(store.getProfile).toHaveBeenCalledWith("user-1");
    expect(store.listAddresses).toHaveBeenCalledWith("user-1");
    expect(store.listProducts).toHaveBeenCalledWith("user-1", { limit: 50 });
    expect(context.products).toEqual([product]);
    expect(context.addresses).toEqual([address]);
  });
});
