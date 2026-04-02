/**
 * @dmnpc/agent-tools
 *
 * Shareable agentic tools for the DMNPC game engine.
 * Tools use dependency injection for game logic, making them
 * reusable across different contexts (server, CLI, admin tools).
 */

// Re-export from reagent for convenience
export { tool, type Tool } from '@xanister/reagent';

// Types
export * from './types.js';

// Service interfaces
export * from './services/index.js';

// Tools
export * from './tools/index.js';
