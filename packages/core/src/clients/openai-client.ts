import OpenAI from 'openai';
import { config } from '../infra/config.js';
import { logger } from '../infra/logger.js';
import { MODELS } from '../infra/models.js';
import { isRecord } from '../entities/type-guards.js';
import { queryClaudeLlm, createClaudeAgentProvider } from './claude-client.js';

/** Counter for generating unique request IDs. */
let requestCounter = 0;

/**
 * Type for OpenAI Responses API response object.
 * The SDK types may not include these fields, so we define them explicitly.
 */
interface OpenAIResponseWithOutput extends OpenAITruncationFields {
  output_text?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

interface OpenAITruncationFields {
  output_text?: string;
  stop_reason?: string;
  finish_reason?: string;
  status?: string;
}

/**
 * Typed wrapper for OpenAI Responses API.
 * The SDK types don't expose `responses.create()` directly, so we cast once here.
 */
function callResponsesApi<T extends OpenAIResponseWithOutput>(
  client: OpenAI,
  params: Record<string, unknown>,
): Promise<T> {
  // OpenAI SDK typing gap: responses.create() not exposed in SDK types; revisit when SDK updates
  /* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- SDK types incomplete */
  const responsesClient = (
    client as unknown as {
      responses: { create: (params: Record<string, unknown>) => Promise<T> };
    }
  ).responses;
  /* eslint-enable @typescript-eslint/no-unsafe-type-assertion */
  return responsesClient.create(params);
}

/**
 * Safely extract a status code from an error object (e.g. OpenAI SDK errors).
 */
function getErrorStatus(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const { status } = error;
    return typeof status === 'number' ? status : undefined;
  }
  return undefined;
}

/**
 * Safely extract a header value from an error object's headers property.
 */
function getErrorHeader(error: unknown, headerName: string): string | undefined {
  if (!isRecord(error) || !('headers' in error)) return undefined;
  const { headers } = error;
  if (!isRecord(headers)) return undefined;
  const val: unknown = headers[headerName];
  return typeof val === 'string' ? val : undefined;
}

/**
 * Safely extract a message from an error object.
 */
function getErrorMessage(error: unknown): string | undefined {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const { message } = error;
    return typeof message === 'string' ? message : undefined;
  }
  return undefined;
}

/**
 * Complexity tiers for LLM queries.
 * Maps to appropriate models and token limits automatically.
 */
type LlmComplexity =
  | 'orchestration' // gpt-5.2-pro, 4096 tokens - agent loops, multi-step reasoning
  | 'reasoning' // gpt-5.2, 2048 tokens - player-facing, entity generation
  | 'simple' // gpt-5-mini, 1024 tokens - short internal text
  | 'minimal'; // gpt-5-nano, 512 tokens - classification, trivial tasks

/**
 * Configuration for each complexity tier.
 */
const COMPLEXITY_CONFIG: Record<LlmComplexity, { model: string; maxTokens: number }> = {
  orchestration: { model: MODELS.PRO, maxTokens: 4096 },
  reasoning: { model: MODELS.FLAGSHIP, maxTokens: 2048 },
  simple: { model: MODELS.MINI, maxTokens: 1024 },
  minimal: { model: MODELS.NANO, maxTokens: 512 },
};

/**
 * Query parameters for the simplified LLM interface.
 */
export interface LlmQuery {
  /** System prompt (optional). */
  system?: string;
  /** User prompt. */
  prompt: string;
  /** Complexity tier - determines model and token limits. */
  complexity: LlmComplexity;
  /** Context for logging (e.g., 'Character Generator'). */
  context: string;
  /** JSON schema for structured output. If provided, response is parsed as JSON. */
  schema?: {
    name: string;
    schema: object;
  };
  /** Override default max tokens for this complexity tier. */
  maxTokensOverride?: number;
  /** Number of retries on transient failures (default 0). */
  retries?: number;
}

/**
 * Result from an LLM query.
 */
export interface LlmResult<T = string> {
  /** The response content (string or parsed JSON if schema was provided). */
  content: T;
  /** Whether the response was truncated. */
  truncated: boolean;
  /** Duration in milliseconds. */
  durationMs: number;
  /** Input token count (if available from API). */
  inputTokens?: number;
  /** Output token count (if available from API). */
  outputTokens?: number;
}

/**
 * Query the LLM with automatic model selection, truncation detection, and JSON parsing.
 *
 * @example
 * ```typescript
 * // Simple text response
 * const result = await queryLlm({
 *   prompt: 'Describe the sunset',
 *   complexity: 'simple',
 *   context: 'Scene Description',
 * });
 * console.log(result.content); // string
 *
 * // Structured JSON response
 * const result = await queryLlm<{ name: string; age: number }>({
 *   system: 'Generate a character',
 *   prompt: 'Create a fantasy character',
 *   complexity: 'reasoning',
 *   context: 'Character Generator',
 *   schema: {
 *     name: 'character_schema',
 *     schema: {
 *       type: 'object',
 *       properties: {
 *         name: { type: 'string' },
 *         age: { type: 'number' },
 *       },
 *       required: ['name', 'age'],
 *     },
 *   },
 * });
 * console.log(result.content.name); // typed as string
 * ```
 */
export async function queryLlm<T = string>(query: LlmQuery): Promise<LlmResult<T>> {
  if (config.llmProvider === 'claude') {
    return queryClaudeLlm<T>(query);
  }

  const maxRetries = query.retries ?? 1;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await queryLlmInternal<T>(query, attempt);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check for 429 rate limit (OpenAI SDK wraps these with a status property)
      const errorStatus = getErrorStatus(error);
      const isRateLimited = errorStatus === 429;

      // Retry on transient failures (empty response, network errors, rate limits)
      // Truncation is structural (token limit too low) — retrying with the same limit wastes money
      const isTransient =
        isRateLimited ||
        lastError.message.includes('Empty response') ||
        lastError.message.includes('ECONNRESET') ||
        lastError.message.includes('ETIMEDOUT') ||
        lastError.message.includes('socket hang up');

      if (!isTransient || attempt >= maxRetries) {
        throw lastError;
      }

      // Use retry-after header for 429s, otherwise exponential backoff
      let delayMs: number;
      if (isRateLimited) {
        const retryAfterHeader = getErrorHeader(error, 'retry-after');
        const retryAfterSeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 0;
        delayMs = retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : 5000;
        // Cap at 60s to avoid excessively long waits
        delayMs = Math.min(delayMs, 60_000);
      } else {
        delayMs = Math.min(1000 * Math.pow(2, attempt), 8000);
      }

      logger.warn(
        'OpenAI',
        `${isRateLimited ? 'Rate limited' : 'Transient failure'} for ${query.context}, retrying in ${delayMs}ms (attempt ${attempt + 1}/${maxRetries})`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError ?? new Error(`queryLlm failed: ${query.context}`);
}

/**
 * Internal implementation of queryLlm (single attempt).
 */
async function queryLlmInternal<T = string>(
  query: LlmQuery,
  attempt: number,
): Promise<LlmResult<T>> {
  const correlationId = generateCorrelationId();
  const startTime = Date.now();
  const { model, maxTokens } = COMPLEXITY_CONFIG[query.complexity];
  const effectiveMaxTokens = query.maxTokensOverride ?? maxTokens;

  const attemptInfo = attempt > 0 ? ` (retry ${attempt})` : '';
  logger.info(
    'OpenAI',
    `[${correlationId}] Starting: ${query.context}${attemptInfo} model=${model}`,
  );

  const openai = new OpenAI({ apiKey: config.openaiApiKey });

  try {
    const input: Array<{ role: 'system' | 'user'; content: string }> = [];
    if (query.system) {
      input.push({ role: 'system', content: query.system });
    }
    input.push({ role: 'user', content: query.prompt });

    const requestParams: Record<string, unknown> = {
      model,
      input,
      max_output_tokens: effectiveMaxTokens,
    };

    if (query.schema) {
      requestParams.text = {
        format: {
          type: 'json_schema',
          name: query.schema.name,
          schema: query.schema.schema,
        },
      };
    }

    const response = await callResponsesApi<OpenAIResponseWithOutput>(openai, requestParams);
    const durationMs = Date.now() - startTime;

    const usage = response.usage;
    const inputTokens = usage?.input_tokens;
    const outputTokens = usage?.output_tokens;

    const truncated = checkTruncation(response, query.context, correlationId);

    const outputText = response.output_text;
    if (!outputText) {
      logger.error('OpenAI', `[${correlationId}] Empty response: ${query.context}`);
      throw new Error(`Empty response from OpenAI: ${query.context}`);
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
        logger.error('OpenAI', `[${correlationId}] Incomplete JSON: ${query.context}`, {
          cleanedEnd: cleaned.substring(Math.max(0, cleaned.length - 100)),
        });
        throw new Error(`Response truncated (incomplete JSON): ${query.context}`);
      }

      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- queryLlm<T> trusts the caller's type parameter; LLM output validated by JSON schema
        const parsed = JSON.parse(cleaned) as T;
        const tokenInfo =
          inputTokens && outputTokens ? ` tokens=${inputTokens}→${outputTokens}` : '';
        logger.info(
          'OpenAI',
          `[${correlationId}] Completed: ${query.context} durationMs=${durationMs}${tokenInfo}`,
        );
        return {
          content: parsed,
          truncated,
          durationMs,
          inputTokens,
          outputTokens,
        };
      } catch (parseError) {
        logger.error('OpenAI', `[${correlationId}] JSON parse failed: ${query.context}`, {
          error: parseError instanceof Error ? parseError.message : String(parseError),
          cleanedPreview: cleaned.substring(0, 300),
        });
        throw new Error(`Failed to parse JSON: ${query.context}`);
      }
    }

    const tokenInfo = inputTokens && outputTokens ? ` tokens=${inputTokens}→${outputTokens}` : '';
    logger.info(
      'OpenAI',
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
    logger.error('OpenAI', `[${correlationId}] Failed: ${query.context}`, {
      model,
      durationMs,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Internal helper to check for truncation indicators.
 */
function checkTruncation(
  response: OpenAITruncationFields,
  context: string,
  correlationId: string,
): boolean {
  const stopReason = response.stop_reason;
  const finishReason = response.finish_reason;
  const status = response.status;
  const outputText = response.output_text;

  const isTruncated =
    stopReason === 'max_output_tokens' || finishReason === 'length' || status === 'incomplete';

  if (isTruncated) {
    logger.error('OpenAI', `[${correlationId}] Response truncated: ${context}`, {
      stopReason,
      finishReason,
      status,
      outputTextLength: outputText?.length,
      outputTextPreview: outputText?.substring(0, 200),
    });
  }

  return isTruncated;
}

/**
 * Generate a unique correlation ID for tracking requests.
 * Format: `oai-{timestamp}-{counter}`
 */
function generateCorrelationId(): string {
  const timestamp = Date.now().toString(36);
  const counter = (++requestCounter).toString(36).padStart(4, '0');
  return `oai-${timestamp}-${counter}`;
}

/**
 * Create an OpenAI client instance.
 */
export function createOpenAIClient(): OpenAI {
  return new OpenAI({
    apiKey: config.openaiApiKey,
  });
}

/**
 * LLM Provider interface compatible with @xanister/reagent.
 * Implement this to create custom providers.
 */
export interface LLMProvider {
  chat(options: LLMChatOptions): Promise<LLMResponse>;
}

/** Message types in LLM conversation */
export type LLMMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string };

/** Tool call requested by the LLM */
export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

/** Tool definition format for LLM providers */
export interface LLMToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict?: boolean;
}

/** Tool choice options */
export type ToolChoice = 'auto' | 'required' | 'none' | { type: 'tool'; toolName: string };

/** Chat options for LLM provider */
export interface LLMChatOptions {
  messages: LLMMessage[];
  tools?: LLMToolDefinition[];
  toolChoice?: ToolChoice;
}

/** Response from LLM provider */
export interface LLMResponse {
  content?: string;
  toolCalls?: ToolCall[];
  finishReason: 'stop' | 'tool_calls' | 'length';
}

/**
 * Options for creating an agent provider.
 */
export interface AgentProviderOptions {
  /** Model to use for the agent. */
  model: string;
  /** Maximum tokens in response. Default: 4096 */
  maxTokens?: number;
  /** Temperature for response generation. Default: 0.7 */
  temperature?: number;
}

/**
 * Response type from OpenAI Responses API with tool calls.
 */
interface OpenAIAgentResponse {
  output?: Array<{
    type: string;
    id?: string;
    call_id?: string; // Used for function calls
    name?: string;
    arguments?: string;
    content?: Array<{ type: string; text?: string }>;
  }>;
  usage?: { input_tokens?: number; output_tokens?: number };
  status?: string;
  stop_reason?: string;
}

/**
 * Create an LLM provider for use with @xanister/reagent agent loops.
 *
 * Uses our standard infrastructure:
 * - Correlation ID tracking
 * - Request/response logging
 * - Token usage tracking
 * - Duration monitoring
 *
 * @example
 * ```typescript
 * const provider = createAgentProvider({
 *   model: MODELS.FLAGSHIP,
 *   maxTokens: 4096,
 * });
 *
 * const result = await runAgentLoop({
 *   provider,
 *   tools: [...],
 *   systemPrompt: '...',
 *   userPrompt: '...',
 * });
 * ```
 */
export function createAgentProvider(options: AgentProviderOptions): LLMProvider {
  if (config.llmProvider === 'claude') {
    return createClaudeAgentProvider(options);
  }

  const { model, maxTokens = 4096, temperature = 0.7 } = options;

  return {
    async chat(chatOptions: LLMChatOptions): Promise<LLMResponse> {
      const correlationId = generateCorrelationId();
      const startTime = Date.now();

      const toolNames = chatOptions.tools?.map((t) => t.name).join(', ') || 'none';
      logger.info(
        'OpenAI',
        `[${correlationId}] Agent chat: model=${model} tools=[${toolNames}] messages=${chatOptions.messages.length}`,
      );

      const openai = new OpenAI({ apiKey: config.openaiApiKey });

      try {
        const { input, instructions } = convertMessagesToInput(chatOptions.messages);

        const requestParams: Record<string, unknown> = {
          model,
          input,
          max_output_tokens: maxTokens,
          temperature,
        };

        if (instructions) {
          requestParams.instructions = instructions;
        }

        if (chatOptions.tools && chatOptions.tools.length > 0) {
          requestParams.tools = chatOptions.tools.map((tool) => ({
            type: 'function',
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
            strict: tool.strict ?? true,
          }));
        }

        if (chatOptions.toolChoice) {
          requestParams.tool_choice = convertToolChoice(chatOptions.toolChoice);
        }

        const response = await callResponsesApi<OpenAIAgentResponse>(openai, requestParams);

        const durationMs = Date.now() - startTime;

        const inputTokens = response.usage?.input_tokens;
        const outputTokens = response.usage?.output_tokens;
        const tokenInfo =
          inputTokens && outputTokens ? ` tokens=${inputTokens}→${outputTokens}` : '';

        const result = parseAgentResponse(response);

        const toolCallInfo = result.toolCalls?.length
          ? ` toolCalls=[${result.toolCalls.map((tc) => tc.name).join(', ')}]`
          : '';
        logger.info(
          'OpenAI',
          `[${correlationId}] Agent chat completed: durationMs=${durationMs}${tokenInfo} finishReason=${result.finishReason}${toolCallInfo}`,
        );

        return result;
      } catch (error) {
        const durationMs = Date.now() - startTime;
        logger.error('OpenAI', `[${correlationId}] Agent chat failed: model=${model}`, {
          durationMs,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  };
}

/**
 * Convert LLMMessage array to OpenAI Responses API input format.
 *
 * The Responses API uses a different format than Chat Completions:
 * - System messages go in the `instructions` parameter
 * - Function calls are separate items with type: "function_call"
 * - Tool results use type: "function_call_output" with call_id
 */
function convertMessagesToInput(messages: LLMMessage[]): {
  input: Array<Record<string, unknown>>;
  instructions?: string;
} {
  const input: Array<Record<string, unknown>> = [];
  let instructions: string | undefined;

  for (const msg of messages) {
    if (msg.role === 'system') {
      instructions = msg.content;
    } else if (msg.role === 'user') {
      input.push({ role: 'user', content: msg.content });
    } else if (msg.role === 'assistant') {
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        // In Responses API, function calls are separate items, not on the assistant message
        if (msg.content) {
          input.push({
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: msg.content }],
          });
        }
        // Note: id must start with 'fc_', call_id starts with 'call_'
        for (const tc of msg.toolCalls) {
          input.push({
            type: 'function_call',
            call_id: tc.id,
            name: tc.name,
            arguments: JSON.stringify(tc.input),
          });
        }
      } else if (msg.content) {
        input.push({
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: msg.content }],
        });
      }
    } else {
      input.push({
        type: 'function_call_output',
        call_id: msg.toolCallId,
        output: msg.content,
      });
    }
  }

  return { input, instructions };
}

/**
 * Convert ToolChoice to OpenAI format.
 */
function convertToolChoice(
  toolChoice: ToolChoice,
): string | { type: string; function?: { name: string } } {
  if (toolChoice === 'auto' || toolChoice === 'none') {
    return toolChoice;
  }
  if (toolChoice === 'required') {
    return 'required';
  }
  return {
    type: 'function',
    function: { name: toolChoice.toolName },
  };
}

/**
 * Parse OpenAI Responses API response into LLMResponse format.
 */
function parseAgentResponse(response: OpenAIAgentResponse): LLMResponse {
  const output = response.output || [];

  const toolCalls: ToolCall[] = [];
  let content: string | undefined;

  for (const item of output) {
    if (item.type === 'function_call' && item.call_id && item.name) {
      let parsedArgs: unknown = {};
      if (item.arguments) {
        try {
          parsedArgs = JSON.parse(item.arguments);
        } catch {
          parsedArgs = {};
        }
      }
      toolCalls.push({
        id: item.call_id, // Use call_id, not id
        name: item.name,
        input: parsedArgs,
      });
    } else if (item.type === 'message' && item.content) {
      for (const c of item.content) {
        if (c.type === 'output_text' && c.text) {
          content = (content || '') + c.text;
        }
      }
    }
  }

  let finishReason: 'stop' | 'tool_calls' | 'length' = 'stop';
  if (toolCalls.length > 0) {
    finishReason = 'tool_calls';
  } else if (response.status === 'incomplete' || response.stop_reason === 'max_output_tokens') {
    finishReason = 'length';
  }

  return {
    content,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    finishReason,
  };
}

/** Valid image sizes for generation */
type ImageSize = '1024x1024' | '1024x1536' | '1536x1024';

/**
 * Query parameters for image generation.
 */
export interface ImageQuery {
  /** The prompt describing the image to generate. */
  prompt: string;
  /** Image size. Default: '1024x1536' (portrait). */
  size?: ImageSize;
  /** Context for logging (e.g., 'Journal Image'). */
  context: string;
}

/**
 * Result from an image generation query.
 */
export interface ImageResult {
  /** Base64-encoded image data. */
  base64: string;
  /** Duration in milliseconds. */
  durationMs: number;
}

/**
 * Generate an image using OpenAI's image generation API.
 *
 * @example
 * ```typescript
 * const result = await generateImage({
 *   prompt: 'A medieval tavern interior with warm lighting',
 *   size: '1024x1536',
 *   context: 'Scene Image',
 * });
 * console.log(result.base64); // base64 image data
 * ```
 */
export async function generateImage(query: ImageQuery): Promise<ImageResult> {
  const correlationId = generateCorrelationId();
  const startTime = Date.now();
  const size = query.size ?? '1024x1536';

  logger.info(
    'OpenAI',
    `[${correlationId}] Starting image generation: ${query.context} size=${size}`,
  );

  const openai = new OpenAI({ apiKey: config.openaiApiKey });

  try {
    const response = await openai.images.generate({
      model: MODELS.IMAGE,
      prompt: query.prompt,
      size,
    });

    const durationMs = Date.now() - startTime;

    const imageData = response.data?.[0]?.b64_json || response.data?.[0]?.url;
    if (!imageData) {
      logger.error('OpenAI', `[${correlationId}] No image data returned: ${query.context}`);
      throw new Error(`No image data returned from OpenAI: ${query.context}`);
    }

    let base64: string;
    if (typeof imageData === 'string' && imageData.startsWith('http')) {
      const fetchResponse = await fetch(imageData);
      if (!fetchResponse.ok) {
        throw new Error(`Failed to fetch image from URL: ${fetchResponse.statusText}`);
      }
      const arrayBuffer = await fetchResponse.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      base64 = buffer.toString('base64');
      logger.info(
        'OpenAI',
        `[${correlationId}] Image generated (fetched from URL): ${query.context} durationMs=${durationMs}`,
      );
    } else {
      base64 = imageData;
      logger.info(
        'OpenAI',
        `[${correlationId}] Image generated: ${query.context} durationMs=${durationMs}`,
      );
    }

    return { base64, durationMs };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const promptForLog =
      query.prompt.length > 500 ? `${query.prompt.slice(0, 500)}...[truncated]` : query.prompt;
    logger.error('OpenAI', `[${correlationId}] Image generation failed: ${query.context}`, {
      durationMs,
      error: error instanceof Error ? error.message : String(error),
      prompt: promptForLog,
    });
    throw error;
  }
}

/**
 * Parameters for image edit (image-as-reference generation).
 */
export interface ImageEditQuery {
  /** The image to use as reference (PNG buffer). */
  image: Buffer;
  /** Prompt describing the desired output based on the reference. */
  prompt: string;
  /** Image size. Default: '1024x1536' (portrait). */
  size?: ImageSize;
  /** Context for logging. */
  context: string;
}

/**
 * Generate an image using a reference image and prompt (GPT Image 1.5 edit API).
 * Use for Option B/C: sprite-as-reference portrait generation.
 *
 * @example
 * ```typescript
 * const result = await editImage({
 *   image: spriteBuffer,
 *   prompt: 'Create a full-body character portrait from this pixel-art sprite...',
 *   context: 'Portrait from sprite',
 * });
 * ```
 */
export async function editImage(query: ImageEditQuery): Promise<ImageResult> {
  const correlationId = generateCorrelationId();
  const startTime = Date.now();
  const size = query.size ?? '1024x1536';

  logger.info('OpenAI', `[${correlationId}] Starting image edit: ${query.context} size=${size}`);

  const openai = new OpenAI({ apiKey: config.openaiApiKey });

  try {
    const imageCopy = new Uint8Array(query.image.length);
    imageCopy.set(query.image);
    const imageFile = new File([imageCopy], 'reference.png', { type: 'image/png' });

    const response = await openai.images.edit({
      model: MODELS.IMAGE,
      image: imageFile,
      prompt: query.prompt,
      size,
    });

    const durationMs = Date.now() - startTime;

    const imageData = response.data?.[0]?.b64_json || response.data?.[0]?.url;
    if (!imageData) {
      logger.error('OpenAI', `[${correlationId}] No image data returned: ${query.context}`);
      throw new Error(`No image data returned from OpenAI: ${query.context}`);
    }

    let base64: string;
    if (typeof imageData === 'string' && imageData.startsWith('http')) {
      const fetchResponse = await fetch(imageData);
      if (!fetchResponse.ok) {
        throw new Error(`Failed to fetch image from URL: ${fetchResponse.statusText}`);
      }
      const arrayBuffer = await fetchResponse.arrayBuffer();
      base64 = Buffer.from(arrayBuffer).toString('base64');
    } else {
      base64 = imageData;
    }

    logger.info(
      'OpenAI',
      `[${correlationId}] Image edit completed: ${query.context} durationMs=${durationMs}`,
    );

    return { base64, durationMs };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const promptForLog =
      query.prompt.length > 500 ? `${query.prompt.slice(0, 500)}...[truncated]` : query.prompt;
    logger.error('OpenAI', `[${correlationId}] Image edit failed: ${query.context}`, {
      durationMs,
      error: error instanceof Error ? error.message : String(error),
      prompt: promptForLog,
      referenceImageUsed: true,
    });
    throw error;
  }
}

/** Default face anchor position (upper portion of image) */
const DEFAULT_FACE_ANCHOR_Y = 0.15;

/**
 * Result from sprite image analysis.
 */
export interface SpriteAnalysisResult {
  /** Suggested snake_case ID (e.g., 'wooden_chair', 'bookshelf_tall'). */
  suggestedId: string;
  /** Human-readable name (e.g., 'Wooden Chair', 'Tall Bookshelf'). */
  suggestedName: string;
  /** Relevant tags for filtering. */
  suggestedTags: string[];
  /** Brief description of the sprite. */
  description: string;
  /** Category classification. */
  category:
    | 'furniture'
    | 'container'
    | 'decoration'
    | 'fixture'
    | 'floor'
    | 'wall'
    | 'door'
    | 'window'
    | 'lighting'
    | 'other';
  /** Confidence score 0-1. */
  confidence: number;
}

/**
 * Analyze a sprite image using vision to identify what it represents.
 * Returns suggested metadata for the sprite (ID, name, tags, category).
 *
 * @param imageBase64 - Base64-encoded image data (PNG)
 * @param width - Width of the sprite in pixels
 * @param height - Height of the sprite in pixels
 * @param context - Optional context (e.g., tileset/spritesheet name) for better suggestions
 * @returns Analysis result with suggested metadata
 */
export async function analyzeSpriteImage(
  imageBase64: string,
  width: number,
  height: number,
  context?: string,
): Promise<SpriteAnalysisResult> {
  const correlationId = generateCorrelationId();
  const startTime = Date.now();

  logger.info(
    'OpenAI',
    `[${correlationId}] Starting sprite analysis: ${width}x${height}px${context ? ` (${context})` : ''}`,
  );

  const openai = new OpenAI({ apiKey: config.openaiApiKey });

  const systemPrompt = `You are analyzing pixel art sprites from a tileset to identify what object or item they represent.

Your task:
1. Identify what the sprite depicts (furniture, container, decoration, etc.)
2. Generate an appropriate snake_case ID (e.g., 'wooden_chair', 'bookshelf_tall', 'barrel_small')
3. Provide a human-readable name
4. Suggest relevant tags for filtering/categorization
5. Classify into a category
6. Provide a brief description

Guidelines for IDs:
- Use snake_case (e.g., 'round_table', not 'roundTable')
- Be specific but concise (e.g., 'chair_wooden' not just 'chair')
- Include material/style descriptors when apparent (e.g., 'bookshelf_dark_wood')
- For similar items, add size/variant descriptors (e.g., 'crate_small', 'crate_large')

Common categories:
- furniture: tables, chairs, beds, shelves, cabinets
- container: chests, barrels, crates, boxes
- decoration: rugs, paintings, plants, vases
- fixture: fireplaces, stoves, sinks, toilets
- floor: floor tiles, carpets
- wall: wall decorations, mounted items
- door: doors, gates
- window: windows, shutters
- lighting: candles, lamps, torches, chandeliers
- other: anything that doesn't fit above

Common tags to consider:
- Material: wood, metal, stone, fabric, glass
- Style: dark, light, ornate, simple, rustic
- Function: seating, storage, lighting, sleeping
- Size: small, large, tall, wide`;

  const contextInfo = context
    ? `\nContext: This sprite is from the "${context}" tileset/spritesheet.`
    : '';
  const userPrompt = `Analyze this ${width}x${height} pixel sprite and identify what it represents.${contextInfo}

Return a JSON object with these fields:
- suggestedId: snake_case identifier
- suggestedName: Human-readable name
- suggestedTags: Array of relevant tags (3-6 tags)
- description: Brief description (1-2 sentences)
- category: One of: furniture, container, decoration, fixture, floor, wall, door, window, lighting, other
- confidence: How confident you are in this analysis (0-1)`;

  try {
    // Use FLAGSHIP model for vision tasks (MINI may not support vision well)
    const response = await callResponsesApi<OpenAIResponseWithOutput>(openai, {
      model: MODELS.FLAGSHIP,
      input: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'input_text', text: userPrompt },
            {
              type: 'input_image',
              image_url: `data:image/png;base64,${imageBase64}`,
            },
          ],
        },
      ],
      max_output_tokens: 512,
      text: {
        format: {
          type: 'json_schema',
          name: 'sprite_analysis',
          schema: {
            type: 'object',
            properties: {
              suggestedId: { type: 'string', description: 'snake_case identifier' },
              suggestedName: { type: 'string', description: 'Human-readable name' },
              suggestedTags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Relevant tags',
              },
              description: { type: 'string', description: 'Brief description' },
              category: {
                type: 'string',
                enum: [
                  'furniture',
                  'container',
                  'decoration',
                  'fixture',
                  'floor',
                  'wall',
                  'door',
                  'window',
                  'lighting',
                  'other',
                ],
              },
              confidence: { type: 'number', description: 'Confidence 0-1' },
            },
            required: [
              'suggestedId',
              'suggestedName',
              'suggestedTags',
              'description',
              'category',
              'confidence',
            ],
            additionalProperties: false,
          },
        },
      },
    });

    const durationMs = Date.now() - startTime;
    const responseText = (response.output_text || '').trim();

    if (!responseText) {
      logger.warn(
        'OpenAI',
        `[${correlationId}] Sprite analysis returned empty response, using defaults`,
      );
      return {
        suggestedId: `sprite_${width}x${height}`,
        suggestedName: 'Unknown Sprite',
        suggestedTags: [],
        description: 'Analysis returned empty response - please enter details manually',
        category: 'other',
        confidence: 0,
      };
    }

    const cleaned = responseText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    if (!cleaned) {
      logger.warn(
        'OpenAI',
        `[${correlationId}] Sprite analysis returned empty JSON after cleaning`,
      );
      return {
        suggestedId: `sprite_${width}x${height}`,
        suggestedName: 'Unknown Sprite',
        suggestedTags: [],
        description: 'Analysis returned invalid response - please enter details manually',
        category: 'other',
        confidence: 0,
      };
    }

    let result: SpriteAnalysisResult;
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- LLM output validated by JSON schema in the request
      result = JSON.parse(cleaned) as SpriteAnalysisResult;
    } catch (parseError) {
      logger.error('OpenAI', `[${correlationId}] Failed to parse sprite analysis JSON`, {
        error: parseError instanceof Error ? parseError.message : String(parseError),
        responsePreview: cleaned.substring(0, 200),
      });
      return {
        suggestedId: `sprite_${width}x${height}`,
        suggestedName: 'Unknown Sprite',
        suggestedTags: [],
        description: 'Analysis returned malformed response - please enter details manually',
        category: 'other',
        confidence: 0,
      };
    }

    const normalizedResult: SpriteAnalysisResult = {
      suggestedId: String(result.suggestedId || 'unknown_sprite')
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_'),
      suggestedName: String(result.suggestedName || 'Unknown Sprite'),
      suggestedTags: Array.isArray(result.suggestedTags) ? result.suggestedTags.map(String) : [],
      description: String(result.description || 'No description available'),
      category: [
        'furniture',
        'container',
        'decoration',
        'fixture',
        'floor',
        'wall',
        'door',
        'window',
        'lighting',
        'other',
      ].includes(result.category)
        ? result.category
        : 'other',
      confidence:
        typeof result.confidence === 'number' ? Math.max(0, Math.min(1, result.confidence)) : 0.5,
    };

    logger.info(
      'OpenAI',
      `[${correlationId}] Sprite analysis completed: id="${normalizedResult.suggestedId}" category="${normalizedResult.category}" confidence=${normalizedResult.confidence.toFixed(2)} durationMs=${durationMs}`,
    );

    return normalizedResult;
  } catch (error) {
    const durationMs = Date.now() - startTime;
    logger.error('OpenAI', `[${correlationId}] Sprite analysis failed`, {
      durationMs,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      suggestedId: `sprite_${width}x${height}`,
      suggestedName: 'Unknown Sprite',
      suggestedTags: [],
      description: 'Analysis failed - please enter details manually',
      category: 'other',
      confidence: 0,
    };
  }
}

/**
 * Detect the vertical face position in a character portrait using vision.
 * Returns a normalized Y coordinate (0-1) representing where the face center is located.
 *
 * @param imageBase64 - Base64-encoded image data (PNG)
 * @param context - Logging context (e.g., character name)
 * @returns Normalized Y coordinate (0.0 = top, 1.0 = bottom), typically 0.08-0.25 for portraits
 */
export async function detectFacePosition(imageBase64: string, context: string): Promise<number> {
  const correlationId = generateCorrelationId();
  const startTime = Date.now();

  logger.info('OpenAI', `[${correlationId}] Starting face detection: ${context}`);

  const openai = new OpenAI({ apiKey: config.openaiApiKey });

  const systemPrompt = `You are analyzing a character portrait image to determine the vertical position of the face.

Your task:
1. Locate the character's face in the image
2. Determine the vertical center point of the face
3. Return this as a normalized Y coordinate (0.0 = top of image, 1.0 = bottom of image)

For full-body portraits, faces are typically in the range 0.08-0.25.
For taller characters, the face tends to be higher (closer to 0.08-0.12).
For shorter characters (dwarves, gnomes, halflings), the face may be lower (0.15-0.25).`;

  const userPrompt = `Analyze this character portrait and determine the vertical position of the face center.

Return ONLY a single decimal number between 0 and 1 representing the Y coordinate of the face center, where:
- 0.0 = top of the image
- 1.0 = bottom of the image

Example responses: 0.12, 0.18, 0.22

Return ONLY the number, no other text.`;

  try {
    const response = await callResponsesApi<OpenAIResponseWithOutput>(openai, {
      model: MODELS.FLAGSHIP,
      input: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'input_text', text: userPrompt },
            {
              type: 'input_image',
              image_url: `data:image/png;base64,${imageBase64}`,
            },
          ],
        },
      ],
      max_output_tokens: 50,
    });

    const durationMs = Date.now() - startTime;
    const responseText = (response.output_text || '').trim();

    // Parse the numeric response
    const faceY = parseFloat(responseText);

    if (isNaN(faceY) || faceY < 0 || faceY > 1) {
      logger.warn(
        'OpenAI',
        `[${correlationId}] Face detection returned invalid value: "${responseText}", using default`,
      );
      return DEFAULT_FACE_ANCHOR_Y;
    }

    logger.info(
      'OpenAI',
      `[${correlationId}] Face detection completed: ${context} durationMs=${durationMs} faceY=${faceY.toFixed(3)}`,
    );

    return faceY;
  } catch (error) {
    const durationMs = Date.now() - startTime;
    logger.error('OpenAI', `[${correlationId}] Face detection failed: ${context}`, {
      durationMs,
      error: error instanceof Error ? error.message : String(error),
    });
    return DEFAULT_FACE_ANCHOR_Y;
  }
}

interface ErrorResponse {
  status: number;
  message: string;
  retryAfter?: number;
}

/**
 * Handle OpenAI API errors with specific messages.
 * Returns a user-friendly error response based on the error type.
 */
export function handleOpenAIError(error: unknown): ErrorResponse {
  const status = getErrorStatus(error);
  const message = getErrorMessage(error);
  const retryAfter = getErrorHeader(error, 'retry-after');

  if (status === 429) {
    return {
      status: 429,
      message: 'Rate limit exceeded. Please wait a moment and try again.',
      retryAfter: retryAfter ? parseInt(retryAfter, 10) : 60,
    };
  }

  if (status === 401) {
    return {
      status: 401,
      message: 'Invalid API key. Please check your OPENAI_API_KEY environment variable.',
    };
  }

  if (status === 400 && message?.includes('token')) {
    return {
      status: 400,
      message: 'Message is too long. Please shorten your message or start a new conversation.',
    };
  }

  if (status === 402 || message?.includes('quota') || message?.includes('billing')) {
    return {
      status: 402,
      message: 'API quota exceeded. Please check your OpenAI account billing and usage limits.',
    };
  }

  return {
    status: status || 500,
    message: message || 'Failed to generate chat response',
  };
}
