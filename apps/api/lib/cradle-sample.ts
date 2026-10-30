import type { IngestReport } from "@accelerator/domain";

/**
 * What an ingest of Machine Shop reports, for the keyless demo: a subset of the
 * first real ingest (2026-10-30, 22 policies, 3 contradictions), with its
 * citations. The run itself is simulated; the real one runs on the runner.
 */
export const MACHINE_SHOP_INGEST: IngestReport = {
  summary: "A test-mode store: Buy now through Stripe Checkout, one item per order, flat US shipping, an assistant that answers from the catalog, and voice calls whose transcripts are deleted after 30 days.",
  filesRead: 41,
  candidates: [
    { packKey: "C-SHIP-1", concept: "shipping", event: "quote", title: "Flat shipping per order", statement: "Shipping is one flat fee of $9.95 per order.", parameters: { flatFeeUsd: 9.95 }, form: "parametric", sources: [{ path: "lib/checkout.ts", lines: "14", quote: "SHIPPING_FLAT_CENTS = 995" }], surfaces: ["app/p/[id]/page.tsx"] },
    { packKey: null, concept: "shipping", event: "quote", title: "US addresses only", statement: "The store ships only to addresses in the United States.", parameters: { countries: "US" }, form: "parametric", criticality: "important", sources: [{ path: "lib/checkout.ts", lines: "15", quote: 'SHIPPING_COUNTRIES = ["US"]' }] },
    { packKey: "C-CHK-1", concept: "checkout", event: "pay", title: "Card payments go through Stripe", statement: "Stripe Checkout takes the payment. The site never sees a card number.", parameters: { provider: "stripe" }, form: "structural", sources: [{ path: "app/api/checkout/route.ts" }, { path: "lib/stripe.ts" }] },
    { packKey: "C-CHK-2", concept: "checkout", event: "start", title: "The catalog sets the price", statement: "Checkout takes the amount from the catalog. It never uses an amount from the browser.", parameters: {}, form: "structural", sources: [{ path: "lib/checkout.ts", lines: "2-6", quote: "The amount always comes from the catalog" }] },
    { packKey: null, concept: "checkout", event: "start", title: "One item per order", statement: "Each order is one product, quantity 1.", parameters: { maxQuantity: 1 }, form: "parametric", criticality: "important", sources: [{ path: "lib/checkout.ts", lines: "3-4" }] },
    { packKey: null, concept: "checkout", event: "pay", title: "Test mode only", statement: "The store takes payments in Stripe test mode only. No real charge is made.", parameters: { mode: "test" }, form: "parametric", criticality: "critical", sources: [{ path: "lib/checkout.ts", lines: "12", quote: "TEST_MODE_NOTICE" }], surfaces: ["app/layout.tsx", "app/order/success/page.tsx", "app/p/[id]/sheet/page.tsx"] },
    { packKey: "C-PRICE-1", concept: "price", event: "display", title: "Prices show in dollars and cents", statement: "The site shows every price in US dollars with two decimals.", parameters: { currency: "USD", decimals: 2 }, form: "parametric", sources: [{ path: "lib/product.ts" }], surfaces: ["components/product-card.tsx"] },
    { packKey: "C-AST-1", concept: "assistant", event: "answer", title: "The assistant answers from the catalog", statement: "The assistant answers from the catalog through its tools. When it does not know, it says so.", parameters: {}, form: "structural", sources: [{ path: "lib/assistant-tools.ts" }, { path: "lib/assistant-skills.ts" }], surfaces: ["components/assistant.tsx"] },
    { packKey: null, concept: "customer_data", event: "delete", title: "Call transcripts deleted after 30 days", statement: "The store keeps the transcript of a voice call for 30 days. Then it deletes the transcript.", parameters: { days: 30 }, form: "parametric", criticality: "important", sources: [{ path: "lib/voice-store.ts", lines: "13-18" }, { path: "app/owner/transcripts/page.tsx", lines: "19" }] },
    { packKey: null, concept: "assistant", event: "answer", title: "Assistant says the store takes no orders", statement: "The assistant tells shoppers that the store does not take orders.", parameters: {}, form: "structural", criticality: "important", sources: [{ path: "lib/assistant-skills.ts", lines: "52" }, { path: "app/api/assistant/route.ts", lines: "10-11" }] },
    { packKey: null, concept: "order", event: "confirm", title: "Order received page", statement: "The order received page shows the product, the total and a reference. It says the order ships to the address given to Stripe.", parameters: {}, form: "structural", criticality: "important", sources: [{ path: "app/order/success/page.tsx", lines: "27-38" }] },
  ],
  conflicts: [
    { keys: ["Assistant says the store takes no orders", "C-CHK-1"], why: "The typed and voice assistant tell shoppers they cannot order (lib/assistant-skills.ts:52), but the product page has a Buy now button that opens Stripe Checkout. A test (lib/assistant-tools.test.ts:52) locks in the outdated sentence.", kind: "surface" },
    { keys: ["Order received page", "Test mode only"], why: "The order received page says the order ships to the address given to Stripe (app/order/success/page.tsx:38), but the store runs in test mode only, so no real shipment follows.", kind: "surface" },
  ],
};

/** The crew's log for the demo's live ingest view, timed in seconds from the start. */
export const MACHINE_SHOP_INGEST_SCRIPT: { s: number; kind: "status" | "tool" | "log" | "check"; text: string }[] = [
  { s: 0, kind: "status", text: "lead> cradle ingest machine-shop · pack commerce 0.1.0 · read-only" },
  { s: 2, kind: "tool", text: "surveyor> census: 57 files · 13 routes · Next.js 16" },
  { s: 4, kind: "tool", text: "extractor> Read lib/checkout.ts" },
  { s: 6, kind: "log", text: "extractor> C-SHIP-1 flat shipping · code says $9.95 · pack says $7.95 → override found in code" },
  { s: 8, kind: "log", text: "extractor> new: US addresses only · lib/checkout.ts:15" },
  { s: 10, kind: "log", text: "extractor> new: one item per order" },
  { s: 12, kind: "tool", text: "extractor> Read app/api/checkout/route.ts · lib/stripe.ts" },
  { s: 14, kind: "check", text: "extractor> C-CHK-1 Stripe Checkout · matches the pack ✓" },
  { s: 16, kind: "check", text: "extractor> C-CHK-2 the catalog sets the price · matches the pack ✓" },
  { s: 18, kind: "tool", text: "extractor> Read app/layout.tsx · app/order/success/page.tsx · app/p/[id]/sheet/page.tsx" },
  { s: 20, kind: "log", text: "extractor> new: test mode only · stated on 3 pages" },
  { s: 22, kind: "tool", text: "extractor> Read lib/assistant-tools.ts · lib/assistant-skills.ts" },
  { s: 24, kind: "check", text: "extractor> C-AST-1 the assistant answers from the catalog ✓" },
  { s: 26, kind: "tool", text: "extractor> Read lib/voice-store.ts · app/order/success/page.tsx" },
  { s: 28, kind: "log", text: "extractor> new: call transcripts deleted after 30 days · new: order received page" },
  { s: 30, kind: "check", text: "clerk> CONFLICT the assistant says the store takes no orders vs C-CHK-1 Buy now" },
  { s: 32, kind: "check", text: "clerk> CONFLICT the order page promises shipping vs test mode only" },
  { s: 34, kind: "log", text: "gapfinder> holes: product publish · product retire · assistant escalate · order cancel unimplemented" },
  { s: 36, kind: "log", text: "judge> critical policies needing a kernel: order ledger · refunds · tax" },
  { s: 38, kind: "status", text: "lead> 11 policies found in code · 2 contradictions · ready for the Policy Walk" },
];
