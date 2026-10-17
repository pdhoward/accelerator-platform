/**
 * Domain packs (gen2-crew.md §20, D47): the industry a site's crew is
 * configured for. F1 carries each domain's vocabulary and complexity
 * hotspots, which the Team Lead uses when it rates complexity; the full packs
 * (skills, decision points, capability and KPI templates, test scenarios)
 * arrive with the crew in G2.3.
 */

export const DOMAINS = ["commerce", "hospitality"] as const;
export type Domain = (typeof DOMAINS)[number];

export type DomainPack = {
  id: Domain;
  label: string;
  /** One line for the Configuration picker. */
  summary: string;
  /** The terms the crew should use with the client. */
  vocabulary: string[];
  /** Areas that make a change more complex than it looks, with why. */
  hotspots: { area: string; why: string }[];
};

export const DOMAIN_PACKS: Record<Domain, DomainPack> = {
  commerce: {
    id: "commerce",
    label: "Commerce",
    summary: "Online stores and catalogs: products, pricing, carts, checkout and orders.",
    vocabulary: ["catalog", "product", "variant", "price", "promotion", "cart", "checkout", "order", "inventory", "quote", "fulfilment"],
    hotspots: [
      { area: "checkout and payments", why: "money moves and errors cost sales" },
      { area: "pricing, promotions and tax", why: "small rule changes change every order" },
      { area: "inventory and availability", why: "overselling or hiding stock" },
      { area: "orders and customer accounts", why: "personal data and order history" },
      { area: "catalog data writes", why: "the catalog feeds every page and search" },
    ],
  },
  hospitality: {
    id: "hospitality",
    label: "Hospitality",
    summary: "Hotels, resorts and restaurants: availability, rates, reservations, guests and payments.",
    vocabulary: ["property", "room type", "rate plan", "availability", "reservation", "stay", "guest", "folio", "deposit", "cancellation policy", "table booking"],
    hotspots: [
      { area: "rates and availability", why: "wrong prices or double bookings" },
      { area: "reservations and modifications", why: "a guest's stay depends on it" },
      { area: "deposits, payments and refunds", why: "money moves" },
      { area: "cancellation and booking policies", why: "contractual terms with guests" },
      { area: "guest profiles", why: "personal data" },
    ],
  },
};

export const isDomain = (v: unknown): v is Domain => typeof v === "string" && (DOMAINS as readonly string[]).includes(v);

/** What the Team Lead is told about the site's domain when it rates complexity. */
export function domainGuidance(domain: Domain | null): string {
  if (!domain) return "";
  const p = DOMAIN_PACKS[domain];
  return `This site is in the ${p.label} domain (${p.summary}) Use its terms: ${p.vocabulary.join(", ")}.
In ${p.label}, these areas are more complex than they look; a change that touches one is at least Medium, and High when it changes money, personal data or booking or order rules:
${p.hotspots.map((h) => `- ${h.area}: ${h.why}`).join("\n")}`;
}
