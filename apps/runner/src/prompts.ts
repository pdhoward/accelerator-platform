/**
 * The crew's prompt text lives in packages/domain (prompts.ts), so the runner
 * and the API's streaming Team Lead (gen2-crew.md §17 F4) use one copy.
 */
export { brief, buildAppend, buildPrompt, consultSystem, designSystem, planSystem, planText, PROTOCOL, transcript } from "@accelerator/domain";
