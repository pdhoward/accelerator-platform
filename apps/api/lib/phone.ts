import { parsePhoneNumberFromString } from "libphonenumber-js";

/**
 * International mobile numbers: accept "+44 7700 900123", "(914) 500-5391", etc.
 * Numbers without a "+" are read as US; everything is stored as E.164.
 */
export function toE164(input: string): string | null {
  const parsed = parsePhoneNumberFromString(input.trim(), "US");
  return parsed?.isValid() ? parsed.number : null;
}

/** "+19145005391" → "•••• 5391" — the only form shown after entry. */
export const maskPhone = (e164: string) => `•••• ${e164.slice(-4)}`;
