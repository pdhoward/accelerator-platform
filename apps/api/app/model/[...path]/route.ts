import { proxyModel } from "@/lib/model-proxy";

/**
 * The model proxy (gen2-crew.md G2.2b): /model/v1/messages and friends, for
 * agents holding only their job token. A long agent turn streams through
 * here, so the function gets the longest duration the plan allows.
 */
export const maxDuration = 300;
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };

export async function POST(request: Request, { params }: Ctx) {
  return proxyModel(request, (await params).path);
}

export async function GET(request: Request, { params }: Ctx) {
  return proxyModel(request, (await params).path);
}
