import { workRoute } from "@/lib/http";
import { workFingerprint } from "@/lib/work";

type P = { siteId: string; number: string };

/**
 * Pushed updates for one Work item (gen2-crew.md §17 F4): a server-sent
 * "changed" event whenever its messages, jobs, steps or state change, so the
 * page refreshes at once instead of polling. The stream ends after about 50 s
 * (serverless time limits); the client reconnects.
 */
export const GET = workRoute<P>(async ({ request, site, params }) => {
  const number = Number(params.number);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (data: object) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      let last: string | null = null;
      const until = Date.now() + 50_000;
      try {
        send({ type: "ready" });
        while (Date.now() < until && !request.signal.aborted) {
          const fp = await workFingerprint(site.id, number);
          if (last !== null && fp !== last) send({ type: "changed" });
          last = fp;
          await new Promise((r) => setTimeout(r, 1500));
        }
      } catch {
        /* the client reconnects */
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store, no-transform", Connection: "keep-alive" } });
});

export const maxDuration = 60;
