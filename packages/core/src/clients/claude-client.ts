import Anthropic from '@anthropic-ai/sdk';
import { config } from '../infra/config.js';
import { logger } from '../infra/logger.js';
import { CLAUDE_MODELS } from '../infra/models.js';
import type {
  LlmQuery,
  LlmResult,
  AgentProviderOptions,
  LLMProvider,
  LLMChatOptions,
  LLMResponse,
  LLMMessage,
  ToolCall,
  ToolChoice,
  LLMToolDefinition,
} from './openai-client.js';

/** Counter for generating unique request IDs. */
let requestCounter = 0;

/** Complexity tier → Claude model + token limit. */
const COMPLEXITY_CONFIG: Record<string, { model: string; maxTokens: number }> = {
  orchestration: { model: CLAUDE_MODELS.PRO, maxTokens: 4096 },
  reasoning: { model: CLAUDE_MODELS.FLAGSHIP, maxTokens: 2048 },
  simple: { model: CLAUDE_MODELS.MINI, maxTokens: 1024 },
  minimal: { model: CLAUDE_MODELS.NANO, maxTokens: 512 },
};

function generateCorrelationId(): string {
  const timestamp = Date.now().toString(36);
  const counter = (++requestCounter).toString(36).padStart(4, '0');
  return `claude-${timestamp}-${counter}`;
}

/**
 * Query Claude with automatic model selection, truncation detection, and JSON parsing.
 * Drop-in replacement for queryLlmInternal on the OpenAI side.
 */
export async function queryClaudeLlm<T = string>(query: LlmQuery): Promise<LlmResult<T>> {
  const correlationId = generateCorrelationId();
  const startTime = Date.now();
  const tierConfig = COMPLEXITY_CONFIG[query.complexity];
  const model = tierConfig.model;
  const effectiveMaxTokens = query.maxTokensOverride ?? tierConfig.maxTokens;

  logger.info('Claude', `[${correlationId}] Starting: ${query.context} model=${model}`);

  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  try {
    const params: Anthropic.MessageCreateParams = {
      model,
      max_tokens: effectiveMaxTokens,
      messages: [{ role: 'user', content: query.prompt }],
    };

    if (query.system) {
      params.system = query.system;
    }

    if (query.schema) {
      params.output_config = {
        format: {
          type: 'json_schema',
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- LlmQuery.schema.schema is object; SDK requires Record<string, unknown>
          schema: query.schema.schema as Record<string, unknown>,
        },
      };
    }

    const response = await client.messages.create(params);
    const durationMs = Date.now() - startTime;

    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;

    const truncated = response.stop_reason === 'max_tokens';
    if (truncated) {
      logger.error('Claude', `[${correlationId}] Response truncated: ${query.context}`, {
        stopReason: response.stop_reason,
      });
    }

    // Extract text from content blocks
    let outputText = '';
    for (const block of response.content) {
      if (block.type === 'text') {
        outputText += block.text;
      }
    }

    if (!outputText) {
      logger.error('Claude', `[${correlationId}] Empty response: ${query.context}`);
      throw new Error(`Empty response from Claude: ${query.context}`);
    }

    if (query.schema) {
      if (truncated) {
        throw new Error(`Response truncated: ${query.context}`);
      }

      const cleaned = outputText
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();

      if (cleaned && !cleaned.endsWith('}') && !cleaned.endsWith(']')) {
        logger.error('Claude', `[${correlationId}] Incomplete JSON: ${query.context}`, {
          cleanedEnd: cleaned.substring(Math.max(0, cleaned.length - 100)),
        });
        throw new Error(`Response truncated (incomplete JSON): ${query.context}`);
      }

      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- queryClaudeLlm<T> trusts the caller's type parameter; LLM output validated by JSON schema
        const parsed = JSON.parse(cleaned) as T;
        const tokenInfo = ` tokens=${inputTokens}→${outputTokens}`;
        logger.info(
          'Claude',
          `[${correlationId}] Completed: ${query.context} durationMs=${durationMs}${tokenInfo}`,
        );
        return { content: parsed, truncated, durationMs, inputTokens, outputTokens };
      } catch (parseError) {
        logger.error('Claude', `[${correlationId}] JSON parse failed: ${query.context}`, {
          error: parseError instanceof Error ? parseError.message : String(parseError),
          cleanedPreview: cleaned.substring(0, 300),
        });
        throw new Error(`Failed to parse JSON: ${query.context}`);
      }
    }

    const tokenInfo = ` tokens=${inputTokens}→${outputTokens}`;
    logger.info(
      'Claude',
      `[${correlationId}] Completed: ${query.context} durationMs=${durationMs}${tokenInfo}`,
    );

    return {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- T defaults to string; when no schema provided, outputText is the raw string response
      content: outputText as T,
      truncated,
      durationMs,
      inputTokens,
      outputTokens,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    logger.error('Claude', `[${correlationId}] Failed: ${query.context}`, {
      model,
      durationMs,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Create an LLM provider for use with @xanister/reagent agent loops (Claude backend).
 */
export function createClaudeAgentProvider(options: AgentProviderOptions): LLMProvider {
  const { model, maxTokens = 4096, temperature = 0.7 } = options;

  return {
    async chat(chatOptions: LLMChatOptions): Promise<LLMResponse> {
      const correlationId = generateCorrelationId();
      const startTime = Date.now();

      const toolNames = chatOptions.tools?.map((t) => t.name).join(', ') || 'none';
      logger.info(
        'Claude',
        `[${correlationId}] Agent chat: model=${model} tools=[${toolNames}] messages=${chatOptions.messages.length}`,
      );

      const client = new Anthropic({ apiKey: config.anthropicApiKey });

      try {
        const { messages, system } = convertMessages(chatOptions.messages);

        const params: Anthropic.MessageCreateParams = {
          model,
          max_tokens: maxTokens,
          messages,
          temperature,
        };

        if (system) {
          params.system = system;
        }

        if (chatOptions.tools && chatOptions.tools.length > 0) {
          params.tools = chatOptions.tools.map(convertToolDefinition);
        }

        if (chatOptions.toolChoice) {
          params.tool_choice = convertToolChoice(chatOptions.toolChoice);
        }

        const response = await client.messages.create(params);
        const durationMs = Date.now() - startTime;

        const inputTokens = response.usage.input_tokens;
        const outputTokens = response.usage.output_tokens;
        const tokenInfo = ` tokens=${inputTokens}→${outputTokens}`;

        const result = parseResponse(response);

        const toolCallInfo = result.toolCalls?.length
          ? ` toolCalls=[${result.toolCalls.map((tc) => tc.name).join(', ')}]`
          : '';
        logger.info(
          'Claude',
          `[${correlationId}] Agent chat completed: durationMs=${durationMs}${tokenInfo} finishReason=${result.finishReason}${toolCallInfo}`,
        );

        return result;
      } catch (error) {
        const durationMs = Date.now() - startTime;
        logger.error('Claude', `[${correlationId}] Agent chat failed: model=${model}`, {
          durationMs,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  };
}

/**
 * Convert LLMMessage[] to Claude messages format.
 * System messages are extracted to a separate `system` parameter.
 * Tool calls and tool results are mapped to Claude content block format.
 */
function convertMessages(msgs: LLMMessage[]): {
  messages: Anthropic.MessageParam[];
  system?: string;
} {
  const messages: Anthropic.MessageParam[] = [];
  let system: string | undefined;

  for (const msg of msgs) {
    if (msg.role === 'system') {
      system = msg.content;
    } else if (msg.role === 'user') {
      messages.push({ role: 'user', content: msg.content });
    } else if (msg.role === 'assistant') {
      const content: Anthropic.ContentBlockParam[] = [];
      if (msg.content) {
        content.push({ type: 'text', text: msg.content });
      }
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- ToolCall.input is unknown; SDK requires Record<string, unknown>
            input: tc.input as Record<string, unknown>,
          });
        }
      }
      if (content.length > 0) {
        messages.push({ role: 'assistant', content });
      }
    } else {
      // tool result — must be in a user message
      messages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: msg.toolCallId,
            content: msg.content,
          },
        ],
      });
    }
  }

  return { messages, system };
}

function convertToolDefinition(tool: LLMToolDefinition): Anthropic.Tool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: {
      type: 'object' as const,
      ...tool.parameters,
    },
  };
}

function convertToolChoice(choice: ToolChoice): Anthropic.MessageCreateParams['tool_choice'] {
  if (choice === 'auto') return { type: 'auto' };
  if (choice === 'none') return { type: 'auto', disable_parallel_tool_use: true };
  if (choice === 'required') return { type: 'any' };
  return { type: 'tool', name: choice.toolName };
}

function parseResponse(response: Anthropic.Message): LLMResponse {
  const toolCalls: ToolCall[] = [];
  let content: string | undefined;

  for (const block of response.content) {
    if (block.type === 'text') {
      content = (content || '') + block.text;
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        name: block.name,
        input: block.input,
      });
    }
  }

  let finishReason: 'stop' | 'tool_calls' | 'length' = 'stop';
  if (toolCalls.length > 0) {
    finishReason = 'tool_calls';
  } else if (response.stop_reason === 'max_tokens') {
    finishReason = 'length';
  }

  return {
    content,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    finishReason,
  };
}
