import { holdsGates, sse } from "@accelerator/domain";
import { z } from "zod";

import { body, fail, workRoute } from "@/lib/http";
import { streamReply } from "@/lib/work";

type P = { siteId: string; number: string };

const schema = z.object({ body: z.string().trim().min(1).max(8000), shown: z.string().max(200).optional() });

/**
 * Say something and stream the Team Lead's answer as server-sent events
 * (gen2-crew.md §17 F4, §19.2): delta events as the words arrive, then done;
 * "handled" for a typed command; "queued" when the runner answers instead.
 */
export const POST = workRoute<P>(async ({ request, identity, caller, site, params }) => {
  const input = await body(request, schema);
  if (!input) return fail("Write a message.", 400);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: Parameters<typeof sse>[0]) => {
        try {
          controller.enqueue(encoder.encode(sse(e)));
        } catch {
          /* the reader went away; the reply is still recorded */
        }
      };
      try {
        await streamReply(site, identity, { name: caller.name, role: caller.role, member: holdsGates(caller) }, Number(params.number), input.body, input.shown, emit, request.signal);
      } catch (err) {
        emit({ type: "error", message: err instanceof Error ? err.message : "Something went wrong on our side." });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store, no-transform", Connection: "keep-alive" } });
}, "request.create");

export const maxDuration = 60;
