/**
 * Local vs deployed. Vercel sets VERCEL=1 on every deployment, so one env
 * file holds both: NAME_LOCAL on the laptop, NAME_DEPLOYED on Vercel.
 */
export const onVercel = () => !!process.env.VERCEL;

function localOrDeployed(name: string, localDefault: string): string {
  if (!onVercel()) return process.env[`${name}_LOCAL`] ?? localDefault;
  const url = process.env[`${name}_DEPLOYED`];
  if (!url) throw new Error(`${name}_DEPLOYED is not set on this Vercel project.`);
  return url;
}

/** The API, read per request (never baked in at build time). */
export const apiUrl = () => localOrDeployed("API_URL", "http://localhost:4001").replace(/\/$/, "");

export const appStage = () => (process.env.APP_STAGE === "production" ? "production" : process.env.APP_STAGE === "preview" ? "preview" : "development");
