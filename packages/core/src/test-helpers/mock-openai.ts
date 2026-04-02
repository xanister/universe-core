/**
 * OpenAI mock response helpers for tests.
 */

/**
 * Create a mock response for queryLlm that returns simple text content.
 *
 * @example
 * ```typescript
 * queryLlmMock.mockResolvedValueOnce(mockQueryLlmResponse('Hello world'));
 * ```
 */
export function mockQueryLlmResponse(content: string, truncated = false) {
  return { content, truncated, durationMs: 100 };
}

/**
 * Create a mock response for queryLlm when called with a schema.
 * When queryLlm is called with a schema, it automatically parses JSON
 * and returns the parsed object directly as result.content.
 *
 * @example
 * ```typescript
 * queryLlmMock.mockResolvedValueOnce(mockQueryLlmSchemaResponse({
 *   label: 'Test Place',
 *   description: 'A test place',
 * }));
 * ```
 */
export function mockQueryLlmSchemaResponse<T>(data: T, truncated = false) {
  return { content: data, truncated, durationMs: 100 };
}
