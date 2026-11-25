export const DAYS_OF_WEEK = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export type DayOfWeek = (typeof DAYS_OF_WEEK)[number];
export type ScheduleMode = "business" | "per_address";

export interface ScheduleWindow {
  dayOfWeek: DayOfWeek;
  start: string;
  end: string;
  /** Null/omitted = applies to all services. Non-null = linked to that product/service id. */
  productId?: string | null;
}

export interface PublicProfile {
  accountId: string;
  email: string;
  businessName: string;
  phone: string;
  whatsappBusinessInUse: boolean;
  contactName: string;
  contactPhone: string | null;
  scheduleMode: ScheduleMode;
  hours: ScheduleWindow[];
  /** New WhatsApp conversation threads started in conversationsMonth (UTC). */
  conversationsThisMonth: number;
  /** UTC calendar month key `YYYY-MM` for conversationsThisMonth. */
  conversationsMonth: string;
  /** Plan cap for new conversations per month. */
  conversationsMonthlyLimit: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileWrite {
  businessName: string;
  phone: string;
  whatsappBusinessInUse: boolean;
  contactName: string;
  contactPhone: string | null;
  scheduleMode: ScheduleMode;
  hours: ScheduleWindow[];
}

export interface ProfilePatch {
  businessName?: string;
  phone?: string;
  whatsappBusinessInUse?: boolean;
  contactName?: string;
  contactPhone?: string | null;
  scheduleMode?: ScheduleMode;
  hours?: ScheduleWindow[];
}

export interface PublicAddress {
  id: string;
  label: string | null;
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  postalCode: string | null;
  country: string;
  hours: ScheduleWindow[];
  createdAt: string;
  updatedAt: string;
}

export interface AddressWrite {
  label: string | null;
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  postalCode: string | null;
  country: string;
  hours: ScheduleWindow[];
}

export interface AddressPatch {
  label?: string | null;
  line1?: string;
  line2?: string | null;
  city?: string;
  region?: string | null;
  postalCode?: string | null;
  country?: string;
  hours?: ScheduleWindow[];
}

export type ProductKind = "product" | "service";

export interface PricePlan {
  name: string;
  priceMinor: number;
  rules: string | null;
}

export interface PublicProduct {
  id: string;
  name: string;
  description: string | null;
  kind?: ProductKind;
  priceMinor: number;
  priceRules?: string | null;
  pricingRules?: string | null;
  plans?: PricePlan[];
  currency: string;
  imageUrls: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ProductWrite {
  name: string;
  description: string | null;
  kind?: ProductKind;
  priceMinor: number;
  priceRules?: string | null;
  pricingRules?: string | null;
  plans?: PricePlan[];
  currency: string;
  imageUrls: string[];
}

export interface ProductPatch {
  name?: string;
  description?: string | null;
  kind?: ProductKind;
  priceMinor?: number;
  priceRules?: string | null;
  pricingRules?: string | null;
  plans?: PricePlan[];
  currency?: string;
  imageUrls?: string[];
}

export interface PublicFaq {
  id: string;
  question: string;
  answer: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface FaqWrite {
  question: string;
  answer: string;
  sortOrder?: number;
}

export interface FaqPatch {
  question?: string;
  answer?: string;
  sortOrder?: number;
}

export interface ProductPage {
  items: PublicProduct[];
  nextCursor: string | null;
}

export interface FieldError {
  ok: false;
  error: string;
  code: string;
  details?: Record<string, unknown>;
}

export type Parsed<T> = { ok: true; value: T } | FieldError;
