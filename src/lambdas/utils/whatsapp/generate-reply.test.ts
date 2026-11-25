import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import {
  buildScheduleByService,
  compactContext,
  formatDaysLabel,
  formatMoney,
  generateWhatsAppReply,
  parseWhatsAppReplyResult,
  resetGenerateReplyClient,
} from "./generate-reply";

jest.mock("@aws-sdk/client-bedrock-runtime", () => {
  const send = jest.fn();
  return {
    ConverseCommand: jest.fn().mockImplementation((input) => input),
    BedrockRuntimeClient: jest.fn().mockImplementation(() => ({ send })),
  };
});

describe("generateWhatsAppReply", () => {
  const previous = process.env.BEDROCK_ANSWER_MODEL_ID;

  beforeEach(() => {
    resetGenerateReplyClient();
    process.env.BEDROCK_ANSWER_MODEL_ID = "us.amazon.nova-pro-v1:0";
    const send = new BedrockRuntimeClient({}).send as jest.Mock;
    send.mockReset();
    send.mockResolvedValue({
      output: {
        message: {
          content: [
            {
              text: '{"answered":true,"reply":"*Funcional*: lunes a viernes 06:00–10:00. ¿Te ayudo con algo más?"}',
            },
          ],
        },
      },
    });
  });

  afterAll(() => {
    if (previous === undefined) delete process.env.BEDROCK_ANSWER_MODEL_ID;
    else process.env.BEDROCK_ANSWER_MODEL_ID = previous;
  });

  it("formats minor units as major currency display", () => {
    expect(formatMoney(5000, "USD")).toBe("50 USD");
    expect(formatMoney(7450, "usd")).toBe("74.50 USD");
  });

  it("collapses consecutive days into ranges", () => {
    expect(
      formatDaysLabel(["monday", "tuesday", "wednesday", "thursday"]),
    ).toBe("monday–thursday");
    expect(formatDaysLabel(["monday", "friday"])).toBe("monday, friday");
    expect(formatDaysLabel(["friday"])).toBe("friday");
  });

  it("groups by service, merges shared hours, and collapses days", () => {
    const names = new Map([
      ["prod-func", "Funcional"],
      ["prod-pil", "Pilates"],
    ]);
    const summary = buildScheduleByService(
      [
        { dayOfWeek: "monday", start: "06:00", end: "10:00", productId: "prod-func" },
        { dayOfWeek: "tuesday", start: "06:00", end: "10:00", productId: "prod-func" },
        { dayOfWeek: "wednesday", start: "06:00", end: "10:00", productId: "prod-func" },
        { dayOfWeek: "thursday", start: "06:00", end: "10:00", productId: "prod-func" },
        { dayOfWeek: "friday", start: "06:00", end: "10:00", productId: "prod-func" },
        { dayOfWeek: "monday", start: "10:00", end: "11:00", productId: "prod-pil" },
        { dayOfWeek: "tuesday", start: "10:00", end: "11:00", productId: "prod-pil" },
        { dayOfWeek: "wednesday", start: "10:00", end: "11:00", productId: "prod-pil" },
        { dayOfWeek: "thursday", start: "10:00", end: "11:00", productId: "prod-pil" },
        { dayOfWeek: "friday", start: "10:00", end: "11:00", productId: "prod-pil" },
        { dayOfWeek: "monday", start: "16:00", end: "17:00", productId: "prod-pil" },
        { dayOfWeek: "tuesday", start: "16:00", end: "17:00", productId: "prod-pil" },
        { dayOfWeek: "wednesday", start: "16:00", end: "17:00", productId: "prod-pil" },
        { dayOfWeek: "thursday", start: "16:00", end: "17:00", productId: "prod-pil" },
        { dayOfWeek: "monday", start: "17:00", end: "20:00" },
        { dayOfWeek: "tuesday", start: "17:00", end: "20:00" },
        { dayOfWeek: "wednesday", start: "17:00", end: "20:00" },
        { dayOfWeek: "thursday", start: "17:00", end: "20:00" },
      ],
      names,
    );

    expect(summary).toEqual([
      {
        serviceKey: "prod-func",
        serviceLabel: "Funcional",
        slots: [
          {
            days: ["monday", "tuesday", "wednesday", "thursday", "friday"],
            daysLabel: "monday–friday",
            start: "06:00",
            end: "10:00",
          },
          {
            days: ["monday", "tuesday", "wednesday", "thursday"],
            daysLabel: "monday–thursday",
            start: "17:00",
            end: "20:00",
          },
        ],
      },
      {
        serviceKey: "prod-pil",
        serviceLabel: "Pilates",
        slots: [
          {
            days: ["monday", "tuesday", "wednesday", "thursday", "friday"],
            daysLabel: "monday–friday",
            start: "10:00",
            end: "11:00",
          },
          {
            days: ["monday", "tuesday", "wednesday", "thursday"],
            daysLabel: "monday–thursday",
            start: "16:00",
            end: "17:00",
          },
          {
            days: ["monday", "tuesday", "wednesday", "thursday"],
            daysLabel: "monday–thursday",
            start: "17:00",
            end: "20:00",
          },
        ],
      },
    ]);
  });

  it("keeps shared-only schedules when no product-linked windows exist", () => {
    expect(
      buildScheduleByService(
        [
          { dayOfWeek: "monday", start: "09:00", end: "17:00" },
          { dayOfWeek: "friday", start: "09:00", end: "17:00" },
        ],
        new Map(),
      ),
    ).toEqual([
      {
        serviceKey: "all_services",
        serviceLabel: "all_services",
        slots: [
          {
            days: ["monday", "friday"],
            daysLabel: "monday, friday",
            start: "09:00",
            end: "17:00",
          },
        ],
      },
    ]);
  });

  it("puts scheduleByService on the profile only when hours are requested", () => {
    const context = {
      accountId: "user-1",
      profile: {
        accountId: "user-1",
        email: "ada@example.com",
        businessName: "Ada Gym",
        phone: "+15551234567",

        contactName: "Ada",
        contactPhone: null,
        scheduleMode: "business" as const,
        hours: [
          {
            dayOfWeek: "friday" as const,
            start: "06:00",
            end: "10:00",
            productId: "prod-1",
          },
        ],
        conversationsThisMonth: 0,
        conversationsMonth: "2026-01",
        conversationsMonthlyLimit: 100,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        plan: null,
      },
      products: [
        {
          id: "prod-1",
          name: "Funcional",
          description: null,
          kind: "service" as const,
          priceMinor: 5000,
          currency: "USD",
          priceRules: null,
          pricingRules: null,
          plans: [],
          imageUrls: [],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    };

    expect(compactContext(context, { includeSchedule: true }).profile).toEqual(
      expect.objectContaining({
        scheduleByService: [
          {
            serviceKey: "prod-1",
            serviceLabel: "Funcional",
            slots: [
              {
                days: ["friday"],
                daysLabel: "friday",
                start: "06:00",
                end: "10:00",
              },
            ],
          },
        ],
      }),
    );

    expect(
      (compactContext(context, { includeSchedule: false }).profile as Record<
        string,
        unknown
      >).scheduleByService,
    ).toBeUndefined();
  });

  it("skips product-linked windows when the product name is unknown", () => {
    expect(
      buildScheduleByService(
        [
          {
            dayOfWeek: "monday",
            start: "06:00",
            end: "10:00",
            productId: "orphan-id",
          },
          { dayOfWeek: "monday", start: "17:00", end: "20:00" },
        ],
        new Map(),
      ),
    ).toEqual([
      {
        serviceKey: "all_services",
        serviceLabel: "all_services",
        slots: [
          {
            days: ["monday"],
            daysLabel: "monday",
            start: "17:00",
            end: "20:00",
          },
        ],
      },
    ]);
  });

  it("parses answered and unanswered JSON results", () => {
    expect(
      parseWhatsAppReplyResult(
        '{"answered":true,"reply":"Hola, estamos en Cuenca."}',
      ),
    ).toEqual({ answered: true, text: "Hola, estamos en Cuenca." });

    expect(
      parseWhatsAppReplyResult(
        '{"answered":false,"reason":"no parking info in context"}',
      ),
    ).toEqual({ answered: false, reason: "no parking info in context" });
  });

  it("calls Nova Pro and returns an answered reply", async () => {
    const send = new BedrockRuntimeClient({}).send as jest.Mock;
    const result = await generateWhatsAppReply({
      customerMessage: "What are your hours?",
      sources: ["hours"],
      intentReason: "asks about hours",
      context: {
        accountId: "user-1",
        profile: {
          accountId: "user-1",
          email: "ada@example.com",
          businessName: "Ada Gym",
          phone: "+15551234567",
  
          contactName: "Ada",
          contactPhone: null,
          scheduleMode: "business",
          hours: [{ dayOfWeek: "monday", start: "09:00", end: "17:00" }],
          conversationsThisMonth: 0,
          conversationsMonth: "2026-01",
          conversationsMonthlyLimit: 100,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          plan: null,
        },
        addresses: [],
      },
    });

    expect(result).toEqual({
      answered: true,
      text: "*Funcional*: lunes a viernes 06:00–10:00. ¿Te ayudo con algo más?",
    });
    expect(ConverseCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: "us.amazon.nova-pro-v1:0",
        inferenceConfig: { maxTokens: 700, temperature: 0.15 },
      }),
    );
    expect(send).toHaveBeenCalledTimes(1);
  });
});
