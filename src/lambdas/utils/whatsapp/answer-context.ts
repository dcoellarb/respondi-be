import { MAX_PRODUCT_PAGE } from "../account/keys";
import { AccountStore } from "../account/store";
import {
  PublicAddress,
  PublicFaq,
  PublicProduct,
  PublicProfile,
} from "../account/types";
import { BusinessDataSource } from "./business-intent";

export interface WhatsAppAnswerContext {
  accountId: string;
  profile?: PublicProfile | null;
  products?: PublicProduct[];
  addresses?: PublicAddress[];
  faqs?: PublicFaq[];
}

export interface WhatsAppAnswerContextSummary {
  profile: boolean;
  products: number | null;
  addresses: number | null;
  faqs: number | null;
}

/**
 * Conditionally loads Dynamo account slices for the classifier `sources`.
 * Fetches run in parallel.
 * - addresses → locations (+ profile for business name / scheduleMode)
 * - hours → profile + addresses (schedule lives on either) + products (name labels)
 */
export async function loadAnswerContext(
  store: AccountStore,
  accountId: string,
  sources: BusinessDataSource[],
): Promise<WhatsAppAnswerContext> {
  const need = new Set(sources);
  const wantHours = need.has("hours");
  const wantProfile =
    need.has("profile") || need.has("addresses") || wantHours;
  const wantProducts = need.has("products") || wantHours;
  const wantAddresses = need.has("addresses") || wantHours;
  const wantFaqs = need.has("faqs");

  const [profile, productPage, addresses, faqs] = await Promise.all([
    wantProfile ? store.getProfile(accountId) : Promise.resolve(undefined),
    wantProducts
      ? store.listProducts(accountId, { limit: MAX_PRODUCT_PAGE })
      : Promise.resolve(undefined),
    wantAddresses ? store.listAddresses(accountId) : Promise.resolve(undefined),
    wantFaqs ? store.listFaqs(accountId) : Promise.resolve(undefined),
  ]);

  const context: WhatsAppAnswerContext = { accountId };
  if (wantProfile) context.profile = profile ?? null;
  if (wantProducts) context.products = productPage?.items ?? [];
  if (wantAddresses) context.addresses = addresses ?? [];
  if (wantFaqs) context.faqs = faqs ?? [];
  return context;
}

export function summarizeAnswerContext(
  context: WhatsAppAnswerContext,
): WhatsAppAnswerContextSummary {
  return {
    profile: context.profile !== undefined ? context.profile !== null : false,
    products: context.products !== undefined ? context.products.length : null,
    addresses: context.addresses !== undefined ? context.addresses.length : null,
    faqs: context.faqs !== undefined ? context.faqs.length : null,
  };
}
