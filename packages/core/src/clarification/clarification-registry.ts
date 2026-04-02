/**
 * Clarification Registry
 *
 * Central registry where clarification providers register themselves.
 * Enables routing answers to the correct provider for resolution.
 */

import type { ClarificationProvider, QuestionCategory } from './clarification-types.js';
import { logger } from '../infra/logger.js';

/**
 * Central registry for clarification providers.
 * Providers register themselves at module load time.
 */
class ClarificationRegistry {
  private providers = new Map<string, ClarificationProvider>();

  /**
   * Register a clarification provider.
   * Called by providers at module load time.
   *
   * @param provider - The provider to register
   * @throws Error if a provider with the same ID is already registered
   */
  register(provider: ClarificationProvider): void {
    if (this.providers.has(provider.providerId)) {
      throw new Error(`Clarification provider already registered: ${provider.providerId}`);
    }

    this.providers.set(provider.providerId, provider);
    logger.info(
      'ClarificationRegistry',
      `Registered provider: ${provider.providerId} (${provider.providerName}) categories=[${provider.categories.join(', ')}]`,
    );
  }

  /**
   * Unregister a provider (primarily for testing).
   *
   * @param providerId - ID of the provider to unregister
   * @returns true if provider was unregistered, false if not found
   */
  unregister(providerId: string): boolean {
    const existed = this.providers.delete(providerId);
    if (existed) {
      logger.info('ClarificationRegistry', `Unregistered provider: ${providerId}`);
    }
    return existed;
  }

  /**
   * Get a provider by ID.
   *
   * @param providerId - ID of the provider
   * @returns The provider or undefined if not found
   */
  getProvider(providerId: string): ClarificationProvider | undefined {
    return this.providers.get(providerId);
  }

  /**
   * Get all registered providers.
   *
   * @returns Array of all providers
   */
  getAllProviders(): ClarificationProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Get providers that handle a specific category.
   *
   * @param category - The question category
   * @returns Array of providers that handle this category
   */
  getProvidersForCategory(category: QuestionCategory): ClarificationProvider[] {
    return this.getAllProviders().filter((p) => p.categories.includes(category));
  }

  /**
   * Check if a provider is registered.
   *
   * @param providerId - ID of the provider
   * @returns true if registered
   */
  hasProvider(providerId: string): boolean {
    return this.providers.has(providerId);
  }

  /**
   * Get the number of registered providers.
   *
   * @returns Count of providers
   */
  get size(): number {
    return this.providers.size;
  }

  /**
   * Clear all providers (primarily for testing).
   */
  clear(): void {
    this.providers.clear();
    logger.info('ClarificationRegistry', 'Cleared all providers');
  }
}

/**
 * Singleton instance of the clarification registry.
 * Import this to register providers or look up providers for resolution.
 */
export const clarificationRegistry = new ClarificationRegistry();
