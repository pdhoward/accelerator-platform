/**
 * Makes a personal reserve code for signing in outside production
 * (work/accounts-auth-admin.md D7). Prints the code once and the line to add
 * to DEV_RESERVE_CODES in envmachine; only the hash is ever stored.
 *
 *   pnpm reserve-code you@example.com
 */
import { createHash, randomInt } from "node:crypto";

const email = process.argv[2]?.trim().toLowerCase();
if (!email || !email.includes("@")) {
  console.error("Usage: pnpm reserve-code <email>");
  process.exit(1);
}
const code = String(randomInt(10_000_000, 100_000_000));
console.log(`Reserve code for ${email}: ${code}   (keep it private; re-run to rotate)`);
console.log(`Add to DEV_RESERVE_CODES: ${email}:${createHash("sha256").update(code).digest("hex")}`);
