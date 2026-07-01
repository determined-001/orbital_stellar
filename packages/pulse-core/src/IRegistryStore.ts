/**
 * Pluggable store for webhook subscription registrations.
 *
 * Maps Stellar addresses to one or more webhook URLs. Implementations may
 * persist registrations to Postgres, Redis, or any durable backend.
 * `InMemoryRegistryStore` ships as a reference for testing and self-hosted
 * deployments that do not require persistence across restarts.
 */
export interface IRegistryStore {
  /**
   * Associates a Stellar address with a set of webhook URLs, replacing any
   * previously registered URLs for that address.
   */
  register(address: string, urls: string[]): Promise<void>;

  /**
   * Removes the registration for a Stellar address. A no-op when the address
   * is not registered.
   */
  deregister(address: string): Promise<void>;

  /**
   * Returns the webhook URLs registered for a Stellar address, or an empty
   * array when the address has no registration.
   */
  get(address: string): Promise<string[]>;

  /**
   * Returns every registered address mapped to its webhook URLs.
   */
  list(): Promise<Record<string, string[]>>;
}

/**
 * In-memory reference implementation of {@link IRegistryStore}.
 *
 * Registrations are lost on process restart. Suitable for tests and
 * single-process self-hosted deployments; replace with a durable
 * implementation (Postgres, Redis, …) for production use.
 */
export class InMemoryRegistryStore implements IRegistryStore {
  private readonly store = new Map<string, string[]>();

  async register(address: string, urls: string[]): Promise<void> {
    this.store.set(address, [...urls]);
  }

  async deregister(address: string): Promise<void> {
    this.store.delete(address);
  }

  async get(address: string): Promise<string[]> {
    return [...(this.store.get(address) ?? [])];
  }

  async list(): Promise<Record<string, string[]>> {
    const result: Record<string, string[]> = {};
    for (const [address, urls] of this.store) {
      result[address] = [...urls];
    }
    return result;
  }
}
