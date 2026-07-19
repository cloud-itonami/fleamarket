/**
 * fleamarket kotoba — barrel.
 *
 * Per ADR-2606011400 (Consensys pattern) MIXED split. The public C2C catalog on
 * the etzhayyim substrate (AT PDS records; no RW).
 *
 *   listing : createListing / getListing / listListings (q = app-layer search) / closeListing
 *   bid     : createBid (FK→open listing) / resolveBid / listBids
 *   coverage
 *
 * Transaction settlement (escrow/MoR) + shipping (fulfillment + address PII)
 * stay etzhayyim infra; only DIDs + public catalog data go on-substrate.
 */

export * from "./types.js";
export {
  createListing,
  getListing,
  listListings,
  closeListing,
  createBid,
  resolveBid,
  listBids,
  coverage,
} from "./registry.js";
