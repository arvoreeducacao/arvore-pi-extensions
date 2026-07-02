import type { AssistantMessage, AssistantMessageEvent } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { ThinkingTagParser } from "../src/thinking-parser.js";

function makeOutput(): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: "kiro-api",
    provider: "kiro",
    model: "test",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

async function run(chunks: string[]): Promise<AssistantMessageEvent[]> {
  const output = makeOutput();
  const stream = createAssistantMessageEventStream();
  const parser = new ThinkingTagParser(output, stream);
  for (const c of chunks) parser.processChunk(c);
  parser.finalize();
  stream.end();
  const events: AssistantMessageEvent[] = [];
  for await (const e of stream) events.push(e);
  return events;
}

function deltas(events: AssistantMessageEvent[], type: string): string {
  return events
    .filter((e) => e.type === type)
    .map((e) => (e as { delta?: string }).delta)
    .join("");
}

describe("Feature 7: Thinking Tag Parser", () => {
  it("emits thinking then text for content with thinking block", async () => {
    const events = await run(["<thinking>Let me think</thinking>\n\nAnswer"]);
    const types = events.map((e) => e.type);
    expect(types).toContain("thinking_start");
    expect(types).toContain("text_start");
    expect(deltas(events, "thinking_delta")).toContain("Let me think");
    expect(deltas(events, "text_delta")).toContain("Answer");
  });

  it("emits only text when no thinking block", async () => {
    const events = await run(["Just plain text"]);
    expect(events.map((e) => e.type)).not.toContain("thinking_start");
    expect(deltas(events, "text_delta")).toBe("Just plain text");
  });

  it("flushes plain text immediately without waiting for finalize", () => {
    const output = makeOutput();
    const stream = createAssistantMessageEventStream();
    const parser = new ThinkingTagParser(output, stream);

    parser.processChunk("Hello world");

    expect(output.content[0]?.type).toBe("text");
    expect(output.content[0]?.type === "text" && output.content[0].text).toBe("Hello world");
  });

  it("retains only a trailing possible opening-tag prefix between chunks", () => {
    const output = makeOutput();
    const stream = createAssistantMessageEventStream();
    const parser = new ThinkingTagParser(output, stream);

    parser.processChunk("Hello <thin");

    expect(output.content[0]?.type).toBe("text");
    expect(output.content[0]?.type === "text" && output.content[0].text).toBe("Hello ");

    parser.processChunk("king>deep thought</thinking>");
    parser.finalize();

    // Thinking block inserted before text block
    expect(output.content[0]?.type).toBe("thinking");
    expect(output.content[0]?.type === "thinking" && output.content[0].thinking).toBe("deep thought");
    expect(output.content[1]?.type === "text" && output.content[1].text).toBe("Hello ");
  });

  it("detects thinking start tag split across chunks", async () => {
    const events = await run(["<thin", "king>deep thought</thinking>"]);
    expect(deltas(events, "thinking_delta")).toContain("deep thought");
  });

  it("detects thinking end tag split across chunks", async () => {
    const events = await run(["<thinking>thought</thi", "nking>\n\nAnswer"]);
    expect(events.map((e) => e.type)).toContain("thinking_end");
    expect(deltas(events, "text_delta")).toContain("Answer");
  });

  it("strips double newline between thinking and text", async () => {
    const events = await run(["<thinking>t</thinking>\n\nAnswer"]);
    expect(deltas(events, "text_delta")).toBe("Answer");
  });

  it("getTextBlockIndex returns null before text emitted", () => {
    const output = makeOutput();
    const stream = createAssistantMessageEventStream();
    const parser = new ThinkingTagParser(output, stream);
    expect(parser.getTextBlockIndex()).toBeNull();
  });

  it("getTextBlockIndex returns 0 for text-only content", () => {
    const output = makeOutput();
    const stream = createAssistantMessageEventStream();
    const parser = new ThinkingTagParser(output, stream);
    parser.processChunk("hello");
    parser.finalize();
    expect(parser.getTextBlockIndex()).toBe(0);
  });

  it("getTextBlockIndex returns 1 after thinking block", () => {
    const output = makeOutput();
    const stream = createAssistantMessageEventStream();
    const parser = new ThinkingTagParser(output, stream);
    parser.processChunk("<thinking>t</thinking>\n\ntext");
    parser.finalize();
    expect(parser.getTextBlockIndex()).toBe(1);
  });

  // =========================================================================
  // Additional thinking tag variants (Task 2.1)
  // =========================================================================

  it("recognizes <think> tags", async () => {
    const events = await run(["<think>Let me think</think>\n\nAnswer"]);
    const types = events.map((e) => e.type);
    expect(types).toContain("thinking_start");
    expect(types).toContain("text_start");
    expect(deltas(events, "thinking_delta")).toContain("Let me think");
    expect(deltas(events, "text_delta")).toContain("Answer");
  });

  it("recognizes <reasoning> tags", async () => {
    const events = await run(["<reasoning>Step by step</reasoning>\n\nResult"]);
    const types = events.map((e) => e.type);
    expect(types).toContain("thinking_start");
    expect(types).toContain("text_start");
    expect(deltas(events, "thinking_delta")).toContain("Step by step");
    expect(deltas(events, "text_delta")).toContain("Result");
  });

  it("recognizes <thought> tags", async () => {
    const events = await run(["<thought>Hmm</thought>\n\nDone"]);
    const types = events.map((e) => e.type);
    expect(types).toContain("thinking_start");
    expect(types).toContain("text_start");
    expect(deltas(events, "thinking_delta")).toContain("Hmm");
    expect(deltas(events, "text_delta")).toContain("Done");
  });

  it("handles <think> split across chunks", async () => {
    const events = await run(["<thi", "nk>deep thought</think>\n\nText"]);
    expect(deltas(events, "thinking_delta")).toContain("deep thought");
    expect(deltas(events, "text_delta")).toContain("Text");
  });

  it("handles <reasoning> split across chunks", async () => {
    const events = await run(["<reason", "ing>logic</reasoning>\n\nOutput"]);
    expect(deltas(events, "thinking_delta")).toContain("logic");
    expect(deltas(events, "text_delta")).toContain("Output");
  });

  it("handles close tag split across chunks for <think>", async () => {
    const events = await run(["<think>idea</th", "ink>\n\nText"]);
    expect(events.map((e) => e.type)).toContain("thinking_end");
    expect(deltas(events, "text_delta")).toContain("Text");
  });

  // =========================================================================
  // Text-before-thinking (Kiro API sends text first, thinking after)
  // =========================================================================

  it("reorders thinking before text when text arrives first", async () => {
    const output = makeOutput();
    const stream = createAssistantMessageEventStream();
    const parser = new ThinkingTagParser(output, stream);

    // Simulate Kiro API: text content arrives before thinking
    parser.processChunk("Hello world");
    parser.processChunk("<thinking>reasoning</thinking>");
    parser.finalize();
    stream.end();

    // Thinking block should be at index 0, text at index 1
    expect(output.content[0]?.type).toBe("thinking");
    expect(output.content[1]?.type).toBe("text");
    expect((output.content[0] as { thinking: string }).thinking).toBe("reasoning");
    expect((output.content[1] as { text: string }).text).toBe("Hello world");
  });

  it("getTextBlockIndex accounts for reordering when text arrives first", () => {
    const output = makeOutput();
    const stream = createAssistantMessageEventStream();
    const parser = new ThinkingTagParser(output, stream);

    parser.processChunk("Hello");
    parser.processChunk("<thinking>t</thinking>");
    parser.finalize();

    // textBlockIndex should be 1 (shifted by thinking insertion)
    expect(parser.getTextBlockIndex()).toBe(1);
  });

  it("handles text-before-thinking across multiple chunks", async () => {
    const output = makeOutput();
    const stream = createAssistantMessageEventStream();
    const parser = new ThinkingTagParser(output, stream);

    parser.processChunk("Hey! ");
    parser.processChunk("What can I help with?");
    parser.processChunk("<thinking>Let me think about this</thinking>");
    parser.finalize();
    stream.end();

    expect(output.content[0]?.type).toBe("thinking");
    expect(output.content[1]?.type).toBe("text");
    expect((output.content[0] as { thinking: string }).thinking).toBe("Let me think about this");
    expect((output.content[1] as { text: string }).text).toBe("Hey! What can I help with?");
  });
});
