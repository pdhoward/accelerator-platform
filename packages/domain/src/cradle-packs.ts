import type { Domain } from "./domains";
import type { Pack, Policy } from "./cradle";

/**
 * The industry packs the Cradle starts from (gen3-cradle.md §3). In time each
 * ships as its own versioned package; for now they live here.
 *
 * Commerce is proven on Machine Shop. Hospitality is modelled on what we know
 * of resort operations; its kernels stay "planned" until the IP position on
 * seeding them from ts-platform is settled (G3-D7). Knowledge only, no code.
 */

const REVIEW = "2027-04-30";
const p = (x: Omit<Policy, "reviewBy" | "owner"> & { owner?: string; reviewBy?: string | null }): Policy => ({ owner: "Steward", reviewBy: REVIEW, ...x });

const COMMERCE: Pack = {
  id: "commerce",
  version: "0.1.0",
  label: "Commerce",
  summary: "Online stores: catalog, pricing, checkout, orders, shipping, returns and customer data.",
  concepts: [
    { key: "product", label: "Product", events: ["publish", "change", "retire"], floor: "routine" },
    { key: "price", label: "Price", events: ["display", "discount"], floor: "important" },
    { key: "checkout", label: "Checkout", events: ["start", "pay", "fail"], floor: "critical" },
    { key: "order", label: "Order", events: ["create", "confirm", "cancel"], floor: "critical" },
    { key: "shipping", label: "Shipping", events: ["quote", "ship"], floor: "important" },
    { key: "refund", label: "Return and refund", events: ["request", "issue"], floor: "critical" },
    { key: "tax", label: "Sales tax", events: ["calculate"], floor: "critical" },
    { key: "inventory", label: "Inventory", events: ["oversell"], floor: "important" },
    { key: "customer_data", label: "Customer data", events: ["collect", "delete"], floor: "critical" },
    { key: "assistant", label: "Shopping assistant", events: ["answer", "escalate"], floor: "routine" },
  ],
  kernels: [
    { key: "order-pricing", label: "Order pricing", kind: "kernel", status: "available" },
    { key: "shipping-quote", label: "Shipping quote", kind: "kernel", status: "available" },
    { key: "stripe-checkout", label: "Stripe Checkout", kind: "connector", status: "available" },
    { key: "order-ledger", label: "Order ledger", kind: "kernel", status: "planned" },
    { key: "refund-engine", label: "Returns and refunds", kind: "kernel", status: "planned" },
    { key: "tax-provider", label: "Tax through the payment provider", kind: "connector", status: "planned" },
  ],
  components: [
    { key: "price-tag", label: "Price and shipping total", expresses: ["C-PRICE-1", "C-SHIP-1"] },
    { key: "buy-button", label: "Buy now", expresses: ["C-CHK-1", "C-INV-1"] },
    { key: "returns-panel", label: "Returns policy", expresses: ["C-REF-1", "C-REF-2"] },
    { key: "policy-explainer", label: "Policy explainer", expresses: [] },
  ],
  policies: [
    p({ key: "C-PRICE-1", concept: "price", event: "display", title: "Prices show in dollars and cents", statement: "The site shows every price in US dollars. The price has two decimals.", criticality: "important", form: "parametric", parameters: { currency: "USD", decimals: 2 }, kernel: "order-pricing",
      examples: [{ given: "A product costs 136.63", when: "a shopper opens its page", then: "the page shows $136.63" }] }),
    p({ key: "C-PRICE-2", concept: "price", event: "discount", title: "No discount below cost", statement: "A discount never makes a price lower than the product's cost.", criticality: "important", form: "parametric", parameters: { floor: "cost" }, kernel: "order-pricing",
      examples: [{ given: "Cost is $80 and price is $100", when: "a 30% discount applies", then: "the price is $80, not $70" }] }),
    p({ key: "C-CHK-1", concept: "checkout", event: "pay", title: "Card payments go through Stripe", statement: "Stripe Checkout takes the payment. The site never sees or stores a card number.", criticality: "critical", form: "structural", parameters: { provider: "stripe" }, kernel: "stripe-checkout", regulation: "PCI DSS: keep card data out of scope",
      examples: [{ given: "A shopper presses Buy now", when: "checkout starts", then: "the shopper pays on a Stripe-hosted page" }] }),
    p({ key: "C-CHK-2", concept: "checkout", event: "start", title: "The catalog sets the price", statement: "Checkout uses the price in the catalog at that moment. Checkout never uses a price sent by the browser.", criticality: "critical", form: "structural", parameters: {}, kernel: "order-pricing",
      examples: [{ given: "The browser sends a price of $1", when: "checkout starts for a $136.63 product", then: "Stripe charges $136.63 plus shipping" }] }),
    p({ key: "C-CHK-3", concept: "checkout", event: "fail", title: "A failed payment creates no order", statement: "When the payment fails, the site creates no order. The shopper can try again.", criticality: "critical", form: "structural", parameters: {}, kernel: "stripe-checkout",
      examples: [{ given: "The card is declined", when: "the shopper returns to the site", then: "no order exists and Buy now still works" }] }),
    p({ key: "C-ORD-1", concept: "order", event: "create", title: "Orders only after confirmed payment", statement: "The site creates an order only after Stripe confirms the payment.", criticality: "critical", form: "structural", parameters: {}, kernel: "order-ledger",
      examples: [{ given: "Stripe sends checkout.session.completed", when: "the webhook arrives", then: "exactly one order is created" }] }),
    p({ key: "C-ORD-2", concept: "order", event: "confirm", title: "Confirmation email within 5 minutes", statement: "The shopper gets an order confirmation by email. The email arrives within 5 minutes of payment.", criticality: "important", form: "parametric", parameters: { minutes: 5 }, kernel: null,
      examples: [{ given: "Payment succeeds at 10:00", when: "the order is created", then: "the confirmation email is sent before 10:05" }] }),
    p({ key: "C-ORD-3", concept: "order", event: "cancel", title: "Cancel before shipping for a full refund", statement: "A shopper can cancel an order before it ships. The shopper then gets a full refund.", criticality: "critical", form: "parametric", parameters: { refundPercent: 100, until: "shipped" }, kernel: "refund-engine",
      examples: [{ given: "An order is paid but not shipped", when: "the shopper cancels", then: "the full amount is refunded" }] }),
    p({ key: "C-SHIP-1", concept: "shipping", event: "quote", title: "Flat shipping per order", statement: "Shipping is one flat fee per order.", criticality: "important", form: "parametric", parameters: { flatFeeUsd: 7.95 }, kernel: "shipping-quote",
      examples: [{ given: "An order of one $136.63 product", when: "checkout totals the order", then: "shipping is the flat fee" }] }),
    p({ key: "C-SHIP-2", concept: "shipping", event: "ship", title: "Ships within 2 business days", statement: "An order ships within 2 business days of payment.", criticality: "important", form: "parametric", parameters: { businessDays: 2 }, kernel: null, examples: [] }),
    p({ key: "C-REF-1", concept: "refund", event: "request", title: "30-day returns", statement: "A shopper can return an unused item. The return must start within 30 days of delivery.", criticality: "critical", form: "parametric", parameters: { days: 30 }, kernel: "refund-engine",
      examples: [{ given: "An item was delivered 31 days ago", when: "the shopper asks to return it", then: "the return is refused, and the shopper is told why" }] }),
    p({ key: "C-REF-2", concept: "refund", event: "issue", title: "Refund to the original card", statement: "The refund goes to the original payment method. The refund is sent within 5 business days of receiving the return.", criticality: "critical", form: "parametric", parameters: { businessDays: 5 }, kernel: "refund-engine", examples: [] }),
    p({ key: "C-TAX-1", concept: "tax", event: "calculate", title: "Tax from the shipping address", statement: "The payment provider calculates sales tax. It uses the shipping address.", criticality: "critical", form: "structural", parameters: { by: "provider" }, kernel: "tax-provider", regulation: "State sales-tax nexus rules",
      examples: [{ given: "The order ships to a state where the shop must collect tax", when: "checkout totals the order", then: "tax for that address is added" }] }),
    p({ key: "C-INV-1", concept: "inventory", event: "oversell", title: "No sale when out of stock", statement: "A shopper cannot buy a product that is out of stock.", criticality: "important", form: "structural", parameters: {}, kernel: "order-pricing",
      examples: [{ given: "Stock is 0", when: "a shopper opens the product", then: "Buy now is unavailable" }] }),
    p({ key: "C-DATA-1", concept: "customer_data", event: "collect", title: "Collect only what fulfilment needs", statement: "The site collects only the data it needs to deliver the order.", criticality: "critical", form: "structural", parameters: {}, kernel: null, regulation: "CCPA / state privacy laws: data minimisation", examples: [] }),
    p({ key: "C-DATA-2", concept: "customer_data", event: "delete", title: "Delete on request within 30 days", statement: "A customer can ask the shop to delete their personal data. The shop completes the request within 30 days.", criticality: "critical", form: "parametric", parameters: { days: 30 }, kernel: null, regulation: "CCPA: right to delete", examples: [] }),
    p({ key: "C-AST-1", concept: "assistant", event: "answer", title: "The assistant answers from the catalog", statement: "The assistant answers only from the catalog and the published policies. When it does not know, it says so.", criticality: "routine", form: "structural", parameters: {}, kernel: null,
      examples: [{ given: "A shopper asks about a warranty the catalog doesn't list", when: "the assistant answers", then: "it says it doesn't know and offers to pass the question on" }] }),
  ],
};

const HOSPITALITY: Pack = {
  id: "hospitality",
  version: "0.1.0",
  label: "Hospitality",
  summary: "Resorts and hotels: availability, rates, reservations, payment schedules, cancellations and guests.",
  concepts: [
    { key: "availability", label: "Availability", events: ["block", "restrict"], floor: "important" },
    { key: "rate", label: "Rate", events: ["set", "override"], floor: "important" },
    { key: "reservation", label: "Reservation", events: ["create", "modify", "cancel", "no_show"], floor: "critical" },
    { key: "payment", label: "Payment", events: ["schedule", "collect", "refund"], floor: "critical" },
    { key: "tax", label: "Lodging tax", events: ["calculate"], floor: "critical" },
    { key: "guest_data", label: "Guest data", events: ["collect", "delete"], floor: "critical" },
  ],
  kernels: [
    { key: "availability-engine", label: "Availability", kind: "kernel", status: "planned" },
    { key: "rate-engine", label: "Rates", kind: "kernel", status: "planned" },
    { key: "cancellation-engine", label: "Cancellation and refunds", kind: "kernel", status: "planned" },
    { key: "payment-schedule", label: "Payment schedule", kind: "kernel", status: "planned" },
    { key: "tax-engine", label: "Lodging tax", kind: "kernel", status: "planned" },
    { key: "stripe-payments", label: "Stripe", kind: "connector", status: "available" },
  ],
  components: [
    { key: "availability-calendar", label: "Availability calendar", expresses: ["H-AVL-1", "H-STAY-1"] },
    { key: "refund-quote", label: "Refund quote", expresses: ["H-CXL-0", "H-CXL-3", "H-CXL-4"] },
    { key: "payment-schedule-view", label: "Payment schedule", expresses: ["H-PAY-1", "H-PAY-2"] },
  ],
  policies: [
    p({ key: "H-AVL-1", concept: "availability", event: "restrict", title: "Book at least 2 days ahead", statement: "A guest must book at least 2 days before arrival.", criticality: "important", form: "parametric", parameters: { minDaysBeforeArrival: 2 }, kernel: "availability-engine", examples: [] }),
    p({ key: "H-STAY-1", concept: "availability", event: "block", title: "Minimum stay of 2 nights", statement: "A stay is at least 2 nights.", criticality: "important", form: "parametric", parameters: { minNights: 2 }, kernel: "availability-engine", examples: [] }),
    p({ key: "H-PAY-1", concept: "payment", event: "schedule", title: "No schedule means pay in full", statement: "When no payment schedule is set, the guest pays in full at booking.", criticality: "critical", form: "structural", parameters: {}, kernel: "payment-schedule",
      examples: [{ given: "No schedule is configured", when: "a guest books a $2,400 stay", then: "$2,400 is due at booking" }] }),
    p({ key: "H-PAY-2", concept: "payment", event: "schedule", title: "The last instalment takes the rounding", statement: "Each instalment is a percentage of the total. The last instalment takes what remains.", criticality: "critical", form: "structural", parameters: {}, kernel: "payment-schedule", examples: [] }),
    p({ key: "H-CXL-0", concept: "reservation", event: "cancel", title: "Refund rules apply in a fixed order", statement: "The rules apply in this order: no-show, then non-cancellable, then the grace period, then the refund bands.", criticality: "critical", form: "structural", parameters: {}, kernel: "cancellation-engine", examples: [] }),
    p({ key: "H-CXL-1", concept: "reservation", event: "no_show", title: "No-show refund", statement: "A guest who does not arrive gets the no-show refund percentage. It is paid in cash.", criticality: "critical", form: "parametric", parameters: { noShowRefundPercent: 0 }, kernel: "cancellation-engine", examples: [] }),
    p({ key: "H-CXL-3", concept: "reservation", event: "cancel", title: "Courtesy grace period", statement: "A guest who cancels within 24 hours of booking gets a full cash refund. This applies only when arrival is more than 7 days away.", criticality: "critical", form: "parametric", parameters: { windowHours: 24, minDaysBeforeArrival: 7 }, kernel: "cancellation-engine",
      examples: [{ given: "Booked Oct 1 for arrival Oct 20", when: "the guest cancels Oct 1", then: "100% is refunded in cash" }] }),
    p({ key: "H-CXL-4", concept: "reservation", event: "cancel", title: "Refund bands by days before arrival", statement: "Otherwise, the first band that matches the days before arrival sets the refund. The band sets the percentage, the fee and the form.", criticality: "critical", form: "parametric", parameters: { bands: "30+:100%, 14-29:50%, <14:0%" }, kernel: "cancellation-engine", examples: [] }),
    p({ key: "H-CXL-5", concept: "reservation", event: "modify", title: "The rules at booking apply", statement: "A change or cancellation uses the rules in force when the guest booked. Later rule changes do not apply.", criticality: "critical", form: "structural", parameters: {}, kernel: "cancellation-engine", examples: [] }),
  ],
};

export const PACKS: Record<Domain, Pack> = { commerce: COMMERCE, hospitality: HOSPITALITY };
export const packFor = (d: Domain | null | undefined): Pack | null => (d ? PACKS[d] ?? null : null);
