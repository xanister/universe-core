import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock @anthropic-ai/sdk before importing the module
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: {
        create: vi.fn(),
      },
    })),
  };
});

describe('claude-client queryClaudeLlm', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    process.env.LLM_PROVIDER = 'claude';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns text content from Claude response', async () => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default as unknown as ReturnType<
      typeof vi.fn
    >;
    const mockCreate = vi.fn().mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Hello from Claude' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 50, output_tokens: 20 },
    });

    Anthropic.mockImplementation(() => ({
      messages: { create: mockCreate },
    }));

    vi.resetModules();
    const { queryClaudeLlm } = await import('@dmnpc/core/clients/claude-client.js');

    const result = await queryClaudeLlm({
      prompt: 'Say hello',
      complexity: 'simple',
      context: 'Test',
    });

    expect(result.content).toBe('Hello from Claude');
    expect(result.truncated).toBe(false);
    expect(result.inputTokens).toBe(50);
    expect(result.outputTokens).toBe(20);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('parses structured JSON output', async () => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default as unknown as ReturnType<
      typeof vi.fn
    >;
    const mockCreate = vi.fn().mockResolvedValueOnce({
      content: [{ type: 'text', text: '{"name":"Gandalf","age":2019}' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 30 },
    });

    Anthropic.mockImplementation(() => ({
      messages: { create: mockCreate },
    }));

    vi.resetModules();
    const { queryClaudeLlm } = await import('@dmnpc/core/clients/claude-client.js');

    const result = await queryClaudeLlm<{ name: string; age: number }>({
      prompt: 'Create a character',
      complexity: 'reasoning',
      context: 'Character Generator',
      schema: {
        name: 'character',
        schema: {
          type: 'object',
          properties: { name: { type: 'string' }, age: { type: 'number' } },
          required: ['name', 'age'],
          additionalProperties: false,
        },
      },
    });

    expect(result.content).toEqual({ name: 'Gandalf', age: 2019 });
    expect(result.truncated).toBe(false);

    // Verify output_config was passed (without name field)
    const callArgs = mockCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs).toHaveProperty('output_config');
  });

  it('detects truncation via max_tokens stop_reason', async () => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default as unknown as ReturnType<
      typeof vi.fn
    >;
    const mockCreate = vi.fn().mockResolvedValueOnce({
      content: [{ type: 'text', text: '{"partial": true' }],
      stop_reason: 'max_tokens',
      usage: { input_tokens: 100, output_tokens: 1024 },
    });

    Anthropic.mockImplementation(() => ({
      messages: { create: mockCreate },
    }));

    vi.resetModules();
    const { queryClaudeLlm } = await import('@dmnpc/core/clients/claude-client.js');

    await expect(
      queryClaudeLlm<{ complete: boolean }>({
        prompt: 'Test',
        complexity: 'simple',
        context: 'Test',
        schema: {
          name: 'test',
          schema: { type: 'object', properties: { complete: { type: 'boolean' } } },
        },
      })
    ).rejects.toThrow('Response truncated');
  });

  it('throws on empty response', async () => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default as unknown as ReturnType<
      typeof vi.fn
    >;
    const mockCreate = vi.fn().mockResolvedValueOnce({
      content: [],
      stop_reason: 'end_turn',
      usage: { input_tokens: 50, output_tokens: 0 },
    });

    Anthropic.mockImplementation(() => ({
      messages: { create: mockCreate },
    }));

    vi.resetModules();
    const { queryClaudeLlm } = await import('@dmnpc/core/clients/claude-client.js');

    await expect(
      queryClaudeLlm({
        prompt: 'Test',
        complexity: 'simple',
        context: 'Test',
      })
    ).rejects.toThrow('Empty response from Claude');
  });

  it('passes system prompt as separate parameter', async () => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default as unknown as ReturnType<
      typeof vi.fn
    >;
    const mockCreate = vi.fn().mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Response' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 80, output_tokens: 10 },
    });

    Anthropic.mockImplementation(() => ({
      messages: { create: mockCreate },
    }));

    vi.resetModules();
    const { queryClaudeLlm } = await import('@dmnpc/core/clients/claude-client.js');

    await queryClaudeLlm({
      system: 'You are a helpful assistant',
      prompt: 'Hello',
      complexity: 'simple',
      context: 'Test',
    });

    const callArgs = mockCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs.system).toBe('You are a helpful assistant');
    expect(callArgs.messages).toEqual([{ role: 'user', content: 'Hello' }]);
  });

  it('uses correct model for each complexity tier', async () => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default as unknown as ReturnType<
      typeof vi.fn
    >;
    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    Anthropic.mockImplementation(() => ({
      messages: { create: mockCreate },
    }));

    vi.resetModules();
    const { queryClaudeLlm } = await import('@dmnpc/core/clients/claude-client.js');

    const tiers = [
      { complexity: 'orchestration' as const, expectedModel: 'claude-opus-4-6' },
      { complexity: 'reasoning' as const, expectedModel: 'claude-sonnet-4-6' },
      { complexity: 'simple' as const, expectedModel: 'claude-haiku-4-5' },
      { complexity: 'minimal' as const, expectedModel: 'claude-haiku-4-5' },
    ];

    for (const { complexity, expectedModel } of tiers) {
      mockCreate.mockClear();
      await queryClaudeLlm({ prompt: 'test', complexity, context: 'Test' });
      const callArgs = mockCreate.mock.calls[0][0] as Record<string, unknown>;
      expect(callArgs.model).toBe(expectedModel);
    }
  });
});

describe('claude-client createClaudeAgentProvider', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns text response from agent chat', async () => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default as unknown as ReturnType<
      typeof vi.fn
    >;
    const mockCreate = vi.fn().mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Agent response' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    Anthropic.mockImplementation(() => ({
      messages: { create: mockCreate },
    }));

    vi.resetModules();
    const { createClaudeAgentProvider } = await import('@dmnpc/core/clients/claude-client.js');

    const provider = createClaudeAgentProvider({
      model: 'claude-sonnet-4-6',
      maxTokens: 4096,
    });

    const result = await provider.chat({
      messages: [
        { role: 'system', content: 'You are an agent' },
        { role: 'user', content: 'Do something' },
      ],
    });

    expect(result.content).toBe('Agent response');
    expect(result.finishReason).toBe('stop');

    // Verify system extracted to separate param
    const callArgs = mockCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs.system).toBe('You are an agent');
  });

  it('handles tool use response', async () => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default as unknown as ReturnType<
      typeof vi.fn
    >;
    const mockCreate = vi.fn().mockResolvedValueOnce({
      content: [
        { type: 'text', text: 'I will create a place.' },
        {
          type: 'tool_use',
          id: 'toolu_123',
          name: 'create_place',
          input: { name: 'Tavern', purpose: 'tavern' },
        },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 200, output_tokens: 80 },
    });

    Anthropic.mockImplementation(() => ({
      messages: { create: mockCreate },
    }));

    vi.resetModules();
    const { createClaudeAgentProvider } = await import('@dmnpc/core/clients/claude-client.js');

    const provider = createClaudeAgentProvider({ model: 'claude-opus-4-6' });

    const result = await provider.chat({
      messages: [{ role: 'user', content: 'Create a tavern' }],
      tools: [
        {
          name: 'create_place',
          description: 'Creates a place',
          parameters: {
            properties: { name: { type: 'string' }, purpose: { type: 'string' } },
            required: ['name', 'purpose'],
          },
        },
      ],
    });

    expect(result.finishReason).toBe('tool_calls');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0]).toEqual({
      id: 'toolu_123',
      name: 'create_place',
      input: { name: 'Tavern', purpose: 'tavern' },
    });
    expect(result.content).toBe('I will create a place.');
  });

  it('converts tool results to user messages with tool_result blocks', async () => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default as unknown as ReturnType<
      typeof vi.fn
    >;
    const mockCreate = vi.fn().mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Done' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 300, output_tokens: 10 },
    });

    Anthropic.mockImplementation(() => ({
      messages: { create: mockCreate },
    }));

    vi.resetModules();
    const { createClaudeAgentProvider } = await import('@dmnpc/core/clients/claude-client.js');

    const provider = createClaudeAgentProvider({ model: 'claude-sonnet-4-6' });

    await provider.chat({
      messages: [
        { role: 'user', content: 'Create a tavern' },
        {
          role: 'assistant',
          content: 'Creating...',
          toolCalls: [{ id: 'toolu_123', name: 'create_place', input: { name: 'Tavern' } }],
        },
        { role: 'tool', toolCallId: 'toolu_123', content: '{"id":"place_001"}' },
      ],
    });

    const callArgs = mockCreate.mock.calls[0][0] as {
      messages: Array<{ role: string; content: unknown }>;
    };
    const messages = callArgs.messages;

    // User message
    expect(messages[0]).toEqual({ role: 'user', content: 'Create a tavern' });

    // Assistant message with text + tool_use blocks
    expect(messages[1].role).toBe('assistant');
    const assistantContent = messages[1].content as Array<{ type: string }>;
    expect(assistantContent).toHaveLength(2);
    expect(assistantContent[0]).toEqual({ type: 'text', text: 'Creating...' });
    expect(assistantContent[1]).toMatchObject({ type: 'tool_use', id: 'toolu_123' });

    // Tool result in user message
    expect(messages[2].role).toBe('user');
    const toolContent = messages[2].content as Array<{ type: string; tool_use_id?: string }>;
    expect(toolContent[0]).toMatchObject({
      type: 'tool_result',
      tool_use_id: 'toolu_123',
      content: '{"id":"place_001"}',
    });
  });

  it('maps finishReason for max_tokens truncation', async () => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default as unknown as ReturnType<
      typeof vi.fn
    >;
    const mockCreate = vi.fn().mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Truncated output...' }],
      stop_reason: 'max_tokens',
      usage: { input_tokens: 200, output_tokens: 4096 },
    });

    Anthropic.mockImplementation(() => ({
      messages: { create: mockCreate },
    }));

    vi.resetModules();
    const { createClaudeAgentProvider } = await import('@dmnpc/core/clients/claude-client.js');

    const provider = createClaudeAgentProvider({ model: 'claude-sonnet-4-6' });
    const result = await provider.chat({
      messages: [{ role: 'user', content: 'Write a long story' }],
    });

    expect(result.finishReason).toBe('length');
  });

  it('maps tool_choice correctly', async () => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default as unknown as ReturnType<
      typeof vi.fn
    >;
    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 50, output_tokens: 5 },
    });

    Anthropic.mockImplementation(() => ({
      messages: { create: mockCreate },
    }));

    vi.resetModules();
    const { createClaudeAgentProvider } = await import('@dmnpc/core/clients/claude-client.js');

    const provider = createClaudeAgentProvider({ model: 'claude-sonnet-4-6' });
    const tools = [
      { name: 'test_tool', description: 'A test', parameters: { properties: {} } },
    ];

    // Test 'auto'
    await provider.chat({ messages: [{ role: 'user', content: 'test' }], tools, toolChoice: 'auto' });
    let args = mockCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(args.tool_choice).toEqual({ type: 'auto' });

    // Test 'required' → 'any'
    mockCreate.mockClear();
    await provider.chat({ messages: [{ role: 'user', content: 'test' }], tools, toolChoice: 'required' });
    args = mockCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(args.tool_choice).toEqual({ type: 'any' });

    // Test specific tool
    mockCreate.mockClear();
    await provider.chat({
      messages: [{ role: 'user', content: 'test' }],
      tools,
      toolChoice: { type: 'tool', toolName: 'test_tool' },
    });
    args = mockCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(args.tool_choice).toEqual({ type: 'tool', name: 'test_tool' });
  });
});

describe('llm-dispatch: queryLlm routes based on LLM_PROVIDER', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.LLM_PROVIDER;
  });

  it('routes to Claude when LLM_PROVIDER=claude', async () => {
    process.env.LLM_PROVIDER = 'claude';

    const Anthropic = (await import('@anthropic-ai/sdk')).default as unknown as ReturnType<
      typeof vi.fn
    >;
    const mockCreate = vi.fn().mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Claude response' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 50, output_tokens: 20 },
    });

    Anthropic.mockImplementation(() => ({
      messages: { create: mockCreate },
    }));

    vi.resetModules();
    const { queryLlm } = await import('@dmnpc/core/clients/openai-client.js');

    const result = await queryLlm({
      prompt: 'Test',
      complexity: 'simple',
      context: 'Dispatch Test',
    });

    expect(result.content).toBe('Claude response');
  });
});
