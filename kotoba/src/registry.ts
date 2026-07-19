/**
 * fleamarket kotoba — listing + bid public-catalog registries + coverage.
 * AT PDS records (no RW). Bids FK-reference an existing open listing. Money
 * movement (transactions) + shipping PII stay etzhayyim — not modelled here.
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import {
  BID_COLLECTION,
  CONDITIONS,
  LISTING_COLLECTION,
  bidDidFor,
  bidRkey,
  isCurrency,
  isUintString,
  listingDidFor,
  listingRkey,
  type BidRecord,
  type BidView,
  type CloseListingInput,
  type CloseListingOutput,
  type CoverageInput,
  type CoverageOutput,
  type CreateBidInput,
  type CreateBidOutput,
  type CreateListingInput,
  type CreateListingOutput,
  type GetListingInput,
  type GetListingOutput,
  type ListBidsInput,
  type ListBidsOutput,
  type ListingRecord,
  type ListingView,
  type ListListingsInput,
  type ListListingsOutput,
  type ResolveBidInput,
  type ResolveBidOutput,
} from "./types.js";

const PAGE_LIMIT = 100;
const DEFAULT_MAX_SCAN = 10_000;

// ─── Listing ────────────────────────────────────────────────────────

export async function createListing(e: Etzhayyim, input: CreateListingInput): Promise<CreateListingOutput> {
  if (!input.listingId || !input.sellerDid || !input.title) return { status: "rejected", error: "missingRequiredFields" };
  if (!input.sellerDid.startsWith("did:")) return { status: "rejected", error: "invalidSellerDid" };
  if (!isUintString(input.priceMicros)) return { status: "rejected", error: "invalidPriceMicros" };
  if (!isCurrency((input.currency ?? "").toUpperCase())) return { status: "rejected", error: "invalidCurrency" };
  if (input.condition && !CONDITIONS.has(input.condition)) return { status: "rejected", error: "invalidCondition" };
  const rkey = listingRkey(input.listingId);
  const existing = await e.read<ListingRecord>({ collection: LISTING_COLLECTION, rkey }).catch(() => ({ records: [] }));
  if (existing.records[0]?.value) {
    return { status: "alreadyExists", listingUri: existing.records[0].uri, did: existing.records[0].value.did, listingId: input.listingId };
  }
  const did = listingDidFor(input.listingId);
  const record: ListingRecord = {
    did,
    listingId: input.listingId,
    sellerDid: input.sellerDid,
    title: input.title,
    description: input.description,
    category: input.category,
    priceMicros: input.priceMicros,
    currency: input.currency.toUpperCase(),
    condition: input.condition,
    status: "open",
    createdAt: new Date().toISOString(),
  };
  const receipt = await e.write({ collection: LISTING_COLLECTION, record: record as unknown as Record<string, unknown>, rkey });
  return { status: "created", listingUri: receipt.uri, did, listingId: input.listingId };
}

export async function getListing(e: Etzhayyim, input: GetListingInput): Promise<GetListingOutput> {
  if (!input.listingId) return { error: "invalidListingId" };
  const resp = await e.read<ListingRecord>({ collection: LISTING_COLLECTION, rkey: listingRkey(input.listingId) }).catch(() => ({ records: [] }));
  const r = resp.records[0];
  if (!r) return { error: "notFound" };
  return { listing: { ...r.value, listingUri: r.uri } };
}

export async function listListings(e: Etzhayyim, input: ListListingsInput = {}): Promise<ListListingsOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const resp = await e.read<ListingRecord>({ collection: LISTING_COLLECTION, cursor: input.cursor, limit });
  const q = input.q?.toLowerCase();
  const items: ListingView[] = resp.records
    .filter((r) => {
      const v = r.value;
      if (input.sellerDid && v.sellerDid !== input.sellerDid) return false;
      if (input.category && v.category !== input.category) return false;
      if (input.status && v.status !== input.status) return false;
      if (q && !v.title.toLowerCase().includes(q)) return false;
      return true;
    })
    .map((r) => ({ ...r.value, listingUri: r.uri }));
  return { items, cursor: resp.cursor, total: items.length };
}

export async function closeListing(e: Etzhayyim, input: CloseListingInput): Promise<CloseListingOutput> {
  if (!input.listingId) return { status: "rejected", error: "invalidListingId" };
  if (input.outcome !== "closed" && input.outcome !== "sold") return { status: "rejected", error: "invalidOutcome" };
  const rkey = listingRkey(input.listingId);
  const resp = await e.read<ListingRecord>({ collection: LISTING_COLLECTION, rkey }).catch(() => ({ records: [] }));
  const listing = resp.records[0]?.value;
  if (!listing) return { status: "notFound", error: "listingNotFound" };
  if (listing.status !== "open") return { status: "rejected", error: `listingNotOpen:${listing.status}` };
  await e.write({ collection: LISTING_COLLECTION, record: { ...listing, status: input.outcome } as unknown as Record<string, unknown>, rkey });
  return { status: "closed", listingId: input.listingId, newStatus: input.outcome };
}

// ─── Bid ────────────────────────────────────────────────────────────

export async function createBid(e: Etzhayyim, input: CreateBidInput): Promise<CreateBidOutput> {
  if (!input.bidId || !input.listingId || !input.bidderDid) return { status: "rejected", error: "missingRequiredFields" };
  if (!input.bidderDid.startsWith("did:")) return { status: "rejected", error: "invalidBidderDid" };
  if (!isUintString(input.amountMicros)) return { status: "rejected", error: "invalidAmountMicros" };
  const listResp = await e.read<ListingRecord>({ collection: LISTING_COLLECTION, rkey: listingRkey(input.listingId) }).catch(() => ({ records: [] }));
  const listing = listResp.records[0]?.value;
  if (!listing) return { status: "listingNotFound", error: `listingNotFound:${input.listingId}` };
  if (listing.status !== "open") return { status: "listingClosed", error: `listingNotOpen:${listing.status}` };
  const rkey = bidRkey(input.bidId);
  const existing = await e.read<BidRecord>({ collection: BID_COLLECTION, rkey }).catch(() => ({ records: [] }));
  if (existing.records[0]?.value) {
    return { status: "alreadyExists", bidUri: existing.records[0].uri, did: existing.records[0].value.did, bidId: input.bidId };
  }
  const did = bidDidFor(input.bidId);
  const record: BidRecord = {
    did,
    bidId: input.bidId,
    listingId: input.listingId,
    bidderDid: input.bidderDid,
    amountMicros: input.amountMicros,
    status: "active",
    createdAt: new Date().toISOString(),
  };
  const receipt = await e.write({ collection: BID_COLLECTION, record: record as unknown as Record<string, unknown>, rkey });
  return { status: "created", bidUri: receipt.uri, did, bidId: input.bidId };
}

export async function resolveBid(e: Etzhayyim, input: ResolveBidInput): Promise<ResolveBidOutput> {
  if (!input.bidId) return { status: "rejected", error: "invalidBidId" };
  if (!["withdrawn", "accepted", "rejected"].includes(input.resolution)) return { status: "rejected", error: "invalidResolution" };
  const rkey = bidRkey(input.bidId);
  const resp = await e.read<BidRecord>({ collection: BID_COLLECTION, rkey }).catch(() => ({ records: [] }));
  const bid = resp.records[0]?.value;
  if (!bid) return { status: "notFound", error: "bidNotFound" };
  if (bid.status !== "active") return { status: "rejected", error: `bidNotActive:${bid.status}` };
  await e.write({ collection: BID_COLLECTION, record: { ...bid, status: input.resolution } as unknown as Record<string, unknown>, rkey });
  return { status: "resolved", bidId: input.bidId, newStatus: input.resolution };
}

export async function listBids(e: Etzhayyim, input: ListBidsInput = {}): Promise<ListBidsOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const resp = await e.read<BidRecord>({ collection: BID_COLLECTION, cursor: input.cursor, limit });
  const items: BidView[] = resp.records
    .filter((r) => {
      const v = r.value;
      if (input.listingId && v.listingId !== input.listingId) return false;
      if (input.bidderDid && v.bidderDid !== input.bidderDid) return false;
      if (input.status && v.status !== input.status) return false;
      return true;
    })
    .map((r) => ({ ...r.value, bidUri: r.uri }));
  return { items, cursor: resp.cursor, total: items.length };
}

// ─── Coverage ───────────────────────────────────────────────────────

async function countAll<T>(e: Etzhayyim, collection: string, maxScan: number, onRow: (v: T) => void): Promise<number> {
  let cursor: string | undefined;
  let scanned = 0;
  while (scanned < maxScan) {
    const page = await e.read<T>({ collection, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) {
      if (scanned >= maxScan) break;
      onRow(r.value);
      scanned += 1;
    }
    if (scanned >= maxScan || !page.cursor || page.records.length < PAGE_LIMIT) break;
    cursor = page.cursor;
  }
  return scanned;
}

export async function coverage(e: Etzhayyim, input: CoverageInput = {}): Promise<CoverageOutput> {
  const maxScan = Math.min(input.maxScan ?? DEFAULT_MAX_SCAN, DEFAULT_MAX_SCAN);
  const listingsByStatus: Record<string, number> = {};
  const listingCount = await countAll<ListingRecord>(e, LISTING_COLLECTION, maxScan, (v) => {
    listingsByStatus[v.status] = (listingsByStatus[v.status] ?? 0) + 1;
  });
  const bidsByStatus: Record<string, number> = {};
  const bidCount = await countAll<BidRecord>(e, BID_COLLECTION, maxScan, (v) => {
    bidsByStatus[v.status] = (bidsByStatus[v.status] ?? 0) + 1;
  });
  return {
    listingCount,
    bidCount,
    listingsByStatus,
    bidsByStatus,
    truncated: listingCount >= maxScan || bidCount >= maxScan,
  };
}
