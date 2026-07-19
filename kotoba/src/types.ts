/**
 * fleamarket kotoba — C2C public-catalog record types.
 *
 * Per ADR-2606011400 (Consensys pattern) — MIXED split. fleamarket is a C2C
 * marketplace. This package migrates its PUBLIC catalog:
 *   - listing — items for sale (title / price / category / seller DID / status)
 *   - bid     — offers on a listing (FK→listing)
 * Registry on AT PDS records (replaces RW). ADR-2605172000 kotoba.
 *
 * SPLIT NOTE (ADR-2606011400): the transaction settlement (escrow / merchant-of-
 * record) + shipping (fulfillment liability + buyer address PII) STAY etzhayyim infra,
 * consumed via consent-capability. Only the public listing/bid catalog is
 * etzhayyim-front; buyer/seller PII and money movement never enter these records.
 *
 * AT-Lexicon: no float. Prices are decimal STRINGS in micros (bigint is not
 * JSON-serializable). PII (real names, addresses) MUST NOT be written here — only
 * actor DIDs.
 *
 * Identity hierarchy:
 *   did:web:fleamarket.etzhayyim.com                         — controller
 *   did:web:fleamarket.etzhayyim.com:listing:{listingId}     — a listing
 *   did:web:fleamarket.etzhayyim.com:bid:{bidId}             — a bid
 */

export const FLEA_DID_PREFIX = "did:web:fleamarket.etzhayyim.com:" as const;

export const LISTING_COLLECTION = "com.etzhayyim.apps.fleamarket.listing";
export const BID_COLLECTION = "com.etzhayyim.apps.fleamarket.bid";

// ─── Listing ────────────────────────────────────────────────────────

export type Condition = "new" | "likeNew" | "good" | "fair" | "poor";
export type ListingStatus = "open" | "closed" | "sold";

export interface ListingRecord {
  did: string;
  listingId: string;
  sellerDid: string;
  title: string;
  description?: string;
  category?: string;
  /** Asking price in micros (decimal string). */
  priceMicros: string;
  /** ISO 4217 currency. */
  currency: string;
  condition?: Condition;
  status: ListingStatus;
  createdAt: string;
}
export interface ListingView extends ListingRecord {
  listingUri: string;
}
export interface CreateListingInput {
  listingId: string;
  sellerDid: string;
  title: string;
  priceMicros: string;
  currency: string;
  description?: string;
  category?: string;
  condition?: Condition;
}
export interface CreateListingOutput {
  status: "created" | "alreadyExists" | "rejected";
  listingUri?: string;
  did?: string;
  listingId?: string;
  error?: string;
}
export interface GetListingInput {
  listingId: string;
}
export interface GetListingOutput {
  listing?: ListingView;
  error?: string;
}
export interface ListListingsInput {
  sellerDid?: string;
  category?: string;
  status?: ListingStatus;
  /** App-layer substring match over title (AT PDS has no text search). */
  q?: string;
  limit?: number;
  cursor?: string;
}
export interface ListListingsOutput {
  items: ListingView[];
  cursor?: string;
  total: number;
}
export interface CloseListingInput {
  listingId: string;
  /** "closed" = withdrawn, "sold" = completed. */
  outcome: "closed" | "sold";
}
export interface CloseListingOutput {
  status: "closed" | "notFound" | "rejected";
  listingId?: string;
  newStatus?: ListingStatus;
  error?: string;
}

// ─── Bid ────────────────────────────────────────────────────────────

export type BidStatus = "active" | "withdrawn" | "accepted" | "rejected";

export interface BidRecord {
  did: string;
  bidId: string;
  /** FK → listing listingId. */
  listingId: string;
  bidderDid: string;
  /** Bid amount in micros (decimal string). */
  amountMicros: string;
  status: BidStatus;
  createdAt: string;
}
export interface BidView extends BidRecord {
  bidUri: string;
}
export interface CreateBidInput {
  bidId: string;
  listingId: string;
  bidderDid: string;
  amountMicros: string;
}
export interface CreateBidOutput {
  status: "created" | "alreadyExists" | "rejected" | "listingNotFound" | "listingClosed";
  bidUri?: string;
  did?: string;
  bidId?: string;
  error?: string;
}
export interface ResolveBidInput {
  bidId: string;
  resolution: "withdrawn" | "accepted" | "rejected";
}
export interface ResolveBidOutput {
  status: "resolved" | "notFound" | "rejected";
  bidId?: string;
  newStatus?: BidStatus;
  error?: string;
}
export interface ListBidsInput {
  listingId?: string;
  bidderDid?: string;
  status?: BidStatus;
  limit?: number;
  cursor?: string;
}
export interface ListBidsOutput {
  items: BidView[];
  cursor?: string;
  total: number;
}

// ─── Coverage ───────────────────────────────────────────────────────

export interface CoverageInput {
  maxScan?: number;
}
export interface CoverageOutput {
  listingCount?: number;
  bidCount?: number;
  listingsByStatus?: Record<string, number>;
  bidsByStatus?: Record<string, number>;
  truncated?: boolean;
  error?: string;
}

// ─── Validation + helpers ───────────────────────────────────────────

export const CONDITIONS: ReadonlySet<string> = new Set(["new", "likeNew", "good", "fair", "poor"]);

export function isUintString(s: string): boolean {
  return /^\d+$/.test(s);
}
export function isCurrency(s: string): boolean {
  return /^[A-Z]{3}$/.test(s);
}

export function listingDidFor(id: string): string {
  return `${FLEA_DID_PREFIX}listing:${id.toLowerCase()}`;
}
export function listingRkey(id: string): string {
  return `listing-${id.toLowerCase()}`;
}
export function bidDidFor(id: string): string {
  return `${FLEA_DID_PREFIX}bid:${id.toLowerCase()}`;
}
export function bidRkey(id: string): string {
  return `bid-${id.toLowerCase()}`;
}
