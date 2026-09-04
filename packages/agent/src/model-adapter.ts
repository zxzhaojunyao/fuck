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
      content.push({ type: "tool-call", toolCallId: tc.id, toolName: tc.name, input: tc.arguments })
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
          arguments: tc.input as Record<string, unknown>,
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
