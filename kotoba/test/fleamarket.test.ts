import { describe, it, expect, beforeEach } from "vitest";
import { MockEtzhayyim } from "@etzhayyim/sdk-mock";
import {
  createListing,
  getListing,
  listListings,
  closeListing,
  createBid,
  resolveBid,
  listBids,
  coverage,
} from "../src/index.js";

const SELLER = "did:web:alice.example.com";
const BIDDER = "did:web:bob.example.com";

describe("fleamarket kotoba", () => {
  let e: any;
  beforeEach(() => {
    e = new MockEtzhayyim({ did: "did:web:fleamarket.etzhayyim.com" });
  });

  describe("listing catalog", () => {
    it("creates, reads, lists by category + app-layer search; validates", async () => {
      expect((await createListing(e, { listingId: "L-1", sellerDid: SELLER, title: "Vintage Camera", category: "electronics", priceMicros: "15000000", currency: "jpy", condition: "good" })).status).toBe("created");
      expect((await getListing(e, { listingId: "L-1" })).listing?.currency).toBe("JPY");
      expect((await createListing(e, { listingId: "L-1", sellerDid: SELLER, title: "dup", priceMicros: "1", currency: "JPY" })).status).toBe("alreadyExists");
      expect((await listListings(e, { category: "electronics" })).total).toBe(1);
      expect((await listListings(e, { q: "camera" })).total).toBe(1);
      expect((await createListing(e, { listingId: "L-X", sellerDid: "nope", title: "x", priceMicros: "1", currency: "JPY" })).status).toBe("rejected");
      expect((await createListing(e, { listingId: "L-Y", sellerDid: SELLER, title: "x", priceMicros: "12.5", currency: "JPY" })).status).toBe("rejected");
    });
    it("closes (open→sold/closed), guards re-close", async () => {
      await createListing(e, { listingId: "L-1", sellerDid: SELLER, title: "x", priceMicros: "100", currency: "JPY" });
      expect((await closeListing(e, { listingId: "L-1", outcome: "sold" })).newStatus).toBe("sold");
      expect((await closeListing(e, { listingId: "L-1", outcome: "closed" })).status).toBe("rejected");
    });
  });

  describe("bids against a listing", () => {
    beforeEach(async () => {
      await createListing(e, { listingId: "L-1", sellerDid: SELLER, title: "x", priceMicros: "100000000", currency: "JPY" });
    });
    it("creates (FK→open listing), rejects missing/closed listing + bad amount; resolves", async () => {
      expect((await createBid(e, { bidId: "B-1", listingId: "L-1", bidderDid: BIDDER, amountMicros: "90000000" })).status).toBe("created");
      expect((await createBid(e, { bidId: "B-X", listingId: "GHOST", bidderDid: BIDDER, amountMicros: "1" })).status).toBe("listingNotFound");
      expect((await createBid(e, { bidId: "B-Y", listingId: "L-1", bidderDid: BIDDER, amountMicros: "1.5" })).status).toBe("rejected");
      expect((await listBids(e, { listingId: "L-1", status: "active" })).total).toBe(1);
      expect((await resolveBid(e, { bidId: "B-1", resolution: "accepted" })).newStatus).toBe("accepted");
      expect((await resolveBid(e, { bidId: "B-1", resolution: "withdrawn" })).status).toBe("rejected"); // not active
      // bids on a closed listing are rejected
      await closeListing(e, { listingId: "L-1", outcome: "sold" });
      expect((await createBid(e, { bidId: "B-2", listingId: "L-1", bidderDid: BIDDER, amountMicros: "1" })).status).toBe("listingClosed");
    });
    it("coverage rolls up listings + bids by status", async () => {
      await createBid(e, { bidId: "B-1", listingId: "L-1", bidderDid: BIDDER, amountMicros: "90000000" });
      const cov = await coverage(e);
      expect(cov.listingCount).toBe(1);
      expect(cov.bidCount).toBe(1);
      expect(cov.listingsByStatus?.open).toBe(1);
      expect(cov.bidsByStatus?.active).toBe(1);
    });
  });
});
