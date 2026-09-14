import { streamText, generateText, jsonSchema, stepCountIs, type LanguageModel } from "ai"
import type {
  AgentEvent,
  AgentMessage,
  AssistantMessage,
  ToolCall,
  ToolDefinition,
} from "./types"

// model adapter interface (provider-agnostic)
export type ModelAdapter = {
  stream(
    params: {
      system: string
      messages: AgentMessage[]
      tools: ToolDefinition[]
      signal?: AbortSignal
    },
    emit: (event: AgentEvent) => void
  ): Promise<AssistantMessage>
  // one-shot text generation (no tools), used for context compaction summaries
  summarize(messages: AgentMessage[], system: string): Promise<string>
}

// When the model's output is cut short (finishReason=length), the SDK may hand us raw
// partial JSON (a string) instead of a parsed object. Sending that string back as the
// tool-call input makes some gateways choke (`'str' object has no attribute 'items'`),
// so coerce anything that is not a valid object to a harmless placeholder.
function coerceArgs(input: unknown): Record<string, unknown> {
  if (input && typeof input === "object") return input as Record<string, unknown>
  if (typeof input === "string") {
    try {
      const v = JSON.parse(input)
      if (v && typeof v === "object") return v as Record<string, unknown>
    } catch {
      // truncated / partial JSON — fall through to placeholder below
    }
  }
  return {}
}

// convert internal AgentMessage to AI SDK message format (assistant carries tool-call parts, tool carries tool-result parts)
function toSdkMessage(m: AgentMessage): unknown {
  if (m.role === "user") {
    return { role: "user", content: m.content }
  }
  if (m.role === "assistant") {
    const content: unknown[] = []
    if (m.reasoning) content.push({ type: "reasoning", text: m.reasoning })
    if (m.content) content.push({ type: "text", text: m.content })
    for (const tc of m.toolCalls ?? []) {
      content.push({ type: "tool-call", toolCallId: tc.id, toolName: tc.name, input: coerceArgs(tc.arguments) })
    }
    return { role: "assistant", content }
  }
  if (m.role === "tool") {
    return {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: m.toolCallId,
          toolName: m.toolName,
          output: { type: "text", value: m.content },
        },
      ],
    }
  }
  if (m.role === "compaction") {
    // projectContext folds markers away before sending; this is a safety net in
    // case a marker ever reaches the model directly — render it as plain text.
    return { role: "assistant", content: [{ type: "text", text: "[compaction summary]\n" + m.summary }] }
  }
  throw new Error(`unknown message role: ${String((m as { role?: string }).role)}`)
}

export function createModelAdapter(model: LanguageModel, opts?: { maxOutputTokens?: number }): ModelAdapter {
  const maxOutputTokens = opts?.maxOutputTokens
  return {
    async stream({ system, messages, tools, signal }, emit) {
      const sdkMessages = messages.map(toSdkMessage)
      const sdkTools: Record<string, unknown> = {}
      for (const t of tools) {
        sdkTools[t.name] = {
          description: t.description,
          inputSchema: jsonSchema(t.schema),
        }
      }

      const result = streamText({
        model,
        system,
        messages: sdkMessages as never,
        tools: sdkTools as never,
        stopWhen: stepCountIs(1) as never,
        abortSignal: signal,
        ...(maxOutputTokens ? { maxOutputTokens } : {}),
      })

      emit({ type: "message_start" })
      let content = ""
      for await (const part of result.fullStream) {
        if (part.type === "text-delta") {
          content += part.text
          emit({ type: "message_delta", text: part.text })
        } else if (part.type === "reasoning-delta") {
          emit({ type: "reasoning_delta", text: part.text })
        }
      }

      const final = await result
      const steps = await final.steps
      const step = steps[0]
      const toolCalls: ToolCall[] = (step?.toolCalls ?? []).map(
        (tc: { toolCallId: string; toolName: string; input: unknown }) => ({
          id: tc.toolCallId,
          name: tc.toolName,
          arguments: coerceArgs(tc.input),
        })
      )

      const message: AssistantMessage = {
        role: "assistant",
        content,
        reasoning: step?.reasoningText,
        toolCalls,
        stopReason: step?.finishReason,
        usage: step?.usage
          ? {
              inputTokens: step.usage.inputTokens ?? 0,
              outputTokens: step.usage.outputTokens ?? 0,
            }
          : undefined,
      }
      emit({ type: "message_end", message })
      return message
    },

    async summarize(messages, system) {
      const sdkMessages = messages.map(toSdkMessage)
      const result = await generateText({
        model,
        system,
        messages: sdkMessages as never,
      })
      return result.text
    },
  }
}
