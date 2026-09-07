import { expect, it } from "vitest";
import {
  createReasoningStreamContext,
  createSequencedDraftStream,
  createTelegramDraftStream,
  describeTelegramDispatch,
  dispatchReplyWithBufferedBlockDispatcher,
  dispatchWithContext,
} from "./bot-message-dispatch.test-harness.js";

describeTelegramDispatch("dispatchTelegramMessage progress-markdown", () => {
  it("renders model markdown in the preamble status headline", async () => {
    const draftStream = createSequencedDraftStream(2001);
    createTelegramDraftStream.mockReturnValue(draftStream);
    dispatchReplyWithBufferedBlockDispatcher.mockImplementation(async ({ replyOptions }) => {
      await replyOptions?.onReplyStart?.();
      await replyOptions?.onAssistantMessageStart?.();
      await replyOptions?.onReasoningStream?.({ text: "<think>Running `sleep 4`</think>" });
      await replyOptions?.onToolStart?.({ name: "exec", phase: "start" });
      await replyOptions?.onItemEvent?.({
        kind: "preamble",
        itemId: "c1",
        progressText: "**Reading AGENTS.md**",
      });
      return { queuedFinal: false };
    });

    await dispatchWithContext({
      context: createReasoningStreamContext(),
      streamMode: "progress",
      telegramCfg: {
        streaming: { mode: "progress", progress: { toolProgress: true, label: "Shelling" } },
      },
    });

    const headlinePreview = draftStream.updatePreview.mock.calls
      .map(([preview]) => preview)
      .find((preview) => preview.text.includes("AGENTS.md"));
    expect(headlinePreview?.parseMode).toBe("HTML");
    expect(headlinePreview?.text).toContain("<b>Reading <code>AGENTS.md</code></b>");
    // The fresh headline owns the status slot while reasoning remains buffered.
    expect(headlinePreview?.text).not.toContain("🧠");
    expect(headlinePreview?.text).not.toContain("**");
  });

  it("keeps clipped long reasoning lines italic behind the 🧠 marker", async () => {
    const draftStream = createSequencedDraftStream(2001);
    createTelegramDraftStream.mockReturnValue(draftStream);
    // Real reasoning routinely exceeds the progress clip limit; truncation must
    // clip inside the `_…_` wrapper, not chop the closing underscore (which
    // silently degrades the lane to plain text with a leaked underscore).
    const longThought = "The user wants me to think carefully and run several steps. ".repeat(8);
    dispatchReplyWithBufferedBlockDispatcher.mockImplementation(async ({ replyOptions }) => {
      await replyOptions?.onReplyStart?.();
      await replyOptions?.onAssistantMessageStart?.();
      await replyOptions?.onToolStart?.({ name: "exec", phase: "start" });
      await replyOptions?.onReasoningStream?.({ text: `<think>${longThought}</think>` });
      return { queuedFinal: false };
    });

    await dispatchWithContext({
      context: createReasoningStreamContext(),
      streamMode: "progress",
      telegramCfg: {
        streaming: {
          mode: "progress",
          progress: { toolProgress: true, label: "Shelling", maxLineChars: 300 },
        },
      },
    });

    const lastPreview = draftStream.updatePreview.mock.calls.at(-1)?.[0];
    expect(lastPreview?.parseMode).toBe("HTML");
    expect(lastPreview?.text).toContain("🧠 <i>The user wants me to think carefully");
    expect(lastPreview?.text).toMatch(/…<\/i>/u);
    expect(lastPreview?.text).not.toContain("_");
  });

  it("keeps normalized preamble headline markdown parse_mode-safe", async () => {
    const draftStream = createSequencedDraftStream(2001);
    createTelegramDraftStream.mockReturnValue(draftStream);
    // Models separate narration blocks with `\n\n---\n\n`; headline whitespace
    // normalization must keep that marker from becoming block-level HTML that
    // Telegram rejects.
    const commentary =
      "Planning: three sequential steps with a file read in between.\n\n---\n\n**Step 1:** Run `sleep 6 && date`";
    dispatchReplyWithBufferedBlockDispatcher.mockImplementation(async ({ replyOptions }) => {
      await replyOptions?.onReplyStart?.();
      await replyOptions?.onAssistantMessageStart?.();
      await replyOptions?.onReasoningStream?.({ text: "<think>Planning the steps</think>" });
      await replyOptions?.onToolStart?.({ name: "exec", phase: "start" });
      await replyOptions?.onItemEvent?.({
        kind: "preamble",
        itemId: "c1",
        progressText: commentary,
      });
      return { queuedFinal: false };
    });

    await dispatchWithContext({
      context: createReasoningStreamContext(),
      streamMode: "progress",
      telegramCfg: {
        streaming: { mode: "progress", progress: { toolProgress: true, label: "Shelling" } },
      },
    });

    const headlinePreview = draftStream.updatePreview.mock.calls
      .map(([preview]) => preview)
      .find((preview) => preview.text.includes("three sequential steps"));
    expect(headlinePreview?.parseMode).toBe("HTML");
    expect(headlinePreview?.text).toContain("Planning: three sequential steps");
    expect(headlinePreview?.text).toContain("<b>Step 1:</b>");
    expect(headlinePreview?.text).toContain("<code>sleep 6 &amp;&amp; date</code>");
    expect(headlinePreview?.text).not.toContain("🧠");
    // No rich-only block HTML that Telegram's parse_mode=HTML would reject.
    expect(headlinePreview?.text).not.toMatch(/<(h[1-6]|hr|ul|ol|li|p|div)\b/u);
  });
});
