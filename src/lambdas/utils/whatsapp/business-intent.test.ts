import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import {
  classifyBusinessIntent,
  parseBusinessIntent,
  resetBusinessIntentClient,
} from "./business-intent";

jest.mock("@aws-sdk/client-bedrock-runtime", () => {
  const send = jest.fn();
  return {
    ConverseCommand: jest.fn().mockImplementation((input) => input),
    BedrockRuntimeClient: jest.fn().mockImplementation(() => ({ send })),
  };
});

describe("business intent", () => {
  const previous = process.env.BEDROCK_MODEL_ID;

  beforeEach(() => {
    resetBusinessIntentClient();
    process.env.BEDROCK_MODEL_ID = "us.amazon.nova-micro-v1:0";
    const send = new BedrockRuntimeClient({}).send as jest.Mock;
    send.mockReset();
    send.mockResolvedValue({
      output: {
        message: {
          content: [
            {
              text: '{"businessRelated":true,"sources":["products","addresses"],"reason":"price and downtown hours"}',
            },
          ],
        },
      },
    });
  });

  afterAll(() => {
    if (previous === undefined) delete process.env.BEDROCK_MODEL_ID;
    else process.env.BEDROCK_MODEL_ID = previous;
  });

  it("parses multi-label sources and defaults empty sources to faqs", () => {
    expect(
      parseBusinessIntent(
        '```json\n{"businessRelated":true,"sources":["hours","products","products"],"reason":"hours and price"}\n```',
      ),
    ).toEqual({
      businessRelated: true,
      sources: ["products", "hours"],
      reason: "hours and price",
    });

    expect(
      parseBusinessIntent('{"businessRelated":true,"sources":[],"reason":"policy"}'),
    ).toEqual({
      businessRelated: true,
      sources: ["faqs"],
      reason: "policy",
    });

    expect(
      parseBusinessIntent('{"businessRelated":false,"sources":["products"],"reason":"joke"}'),
    ).toEqual({
      businessRelated: false,
      sources: [],
      reason: "joke",
    });
  });

  it("calls Bedrock Converse once and returns sources", async () => {
    const send = new BedrockRuntimeClient({}).send as jest.Mock;
    const result = await classifyBusinessIntent(
      "How much is the monthly plan and what are downtown hours?",
    );

    expect(result).toEqual({
      businessRelated: true,
      sources: ["products", "addresses"],
      reason: "price and downtown hours",
    });
    expect(ConverseCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: "us.amazon.nova-micro-v1:0",
        inferenceConfig: { maxTokens: 160, temperature: 0 },
      }),
    );
    expect(send).toHaveBeenCalledTimes(1);
  });
});
