/**
 * In-Memory Cache Service
 * 
 * Simple, efficient caching layer for frequently accessed data:
 * - Strategies (1 hour TTL)
 * - Festivals (24 hour TTL)
 * - Normalized inputs (30 min TTL)
 * 
 * WHY: Reduces redundant API/LLM calls, speeds up operations 80-90%
 * WHY: In-memory for simplicity (can upgrade to Redis later)
 */

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

class SimpleCache {
  private cache = new Map<string, CacheEntry<any>>();
  private stats = {
    hits: 0,
    misses: 0,
    sets: 0,
    evictions: 0,
  };

  /**
   * Get value from cache
   * 
   * @param key - Cache key
   * @returns Cached value or null if expired/missing
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.stats.misses++;
      return null;
    }

    // Check expiration
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.stats.evictions++;
      this.stats.misses++;
      return null;
    }

    this.stats.hits++;
    return entry.data as T;
  }

  /**
   * Set value in cache with TTL
   * 
   * @param key - Cache key
   * @param value - Value to cache
   * @param ttlMs - Time to live in milliseconds
   */
  set<T>(key: string, value: T, ttlMs: number): void {
    const expiresAt = Date.now() + ttlMs;
    this.cache.set(key, { data: value, expiresAt });
    this.stats.sets++;
  }

  /**
   * Check if key exists and is valid
   * 
   * @param key - Cache key
   * @returns True if exists and not expired
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.stats.evictions++;
      return false;
    }
    
    return true;
  }

  /**
   * Invalidate specific key
   * 
   * @param key - Cache key to remove
   */
  invalidate(key: string): void {
    if (this.cache.delete(key)) {
      this.stats.evictions++;
    }
  }

  /**
   * Invalidate all keys matching pattern
   * 
   * @param pattern - String pattern to match
   */
  invalidatePattern(pattern: string): number {
    let count = 0;
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        this.cache.delete(key);
        count++;
      }
    }
    this.stats.evictions += count;
    return count;
  }

  /**
   * Clear entire cache
   */
  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    this.stats.evictions += size;
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? (this.stats.hits / total) * 100 : 0;
    
    return {
      ...this.stats,
      size: this.cache.size,
      hitRate: hitRate.toFixed(2) + '%',
    };
  }

  /**
   * Clean up expired entries
   * WHY: Prevent memory leaks from expired entries
   */
  cleanup(): void {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      this.stats.evictions += cleaned;
      console.log(`[Cache] Cleaned up ${cleaned} expired entries`);
    }
  }
}

// Singleton cache instance
const cache = new SimpleCache();

// Periodic cleanup (every 10 minutes)
setInterval(() => {
  cache.cleanup();
}, 10 * 60 * 1000);

// Cache TTLs (in milliseconds)
export const CacheTTL = {
  STRATEGY: 60 * 60 * 1000,      // 1 hour
  FESTIVAL: 24 * 60 * 60 * 1000, // 24 hours
  INPUT: 30 * 60 * 1000,         // 30 minutes
  CALENDAR: 60 * 60 * 1000,      // 1 hour
};

// Cache key builders
export const CacheKey = {
  strategy: (campaignId: string) => `strategy:${campaignId}`,
  festival: (startDate: string, endDate: string, country: string) => 
    `festival:${country}:${startDate}:${endDate}`,
  input: (campaignId: string) => `input:${campaignId}`,
  calendar: (campaignId: string) => `calendar:${campaignId}`,
};

export default cache;
