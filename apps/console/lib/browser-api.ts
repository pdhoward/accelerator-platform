import { createApiClient } from "@accelerator/api-client";

/** Client components: the console's /api/* proxy, which adds the user's token. */
export const browserApi = () => createApiClient({ baseUrl: "" });
