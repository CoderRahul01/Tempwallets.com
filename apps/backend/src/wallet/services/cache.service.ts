import { Injectable, Logger } from '@nestjs/common';

interface CacheEntry<T> {
    data: T;
    expiry: number;
}

@Injectable()
export class CacheService {
    private readonly logger = new Logger(CacheService.name);
    private readonly memoryCache = new Map<string, CacheEntry<any>>();

    // Redis could be injected here if needed, for now using memory cache
    // with a structure that can easily be extended to Redis.

    /**
     * Get data from cache
     */
    async get<T>(key: string): Promise<T | null> {
        const entry = this.memoryCache.get(key);

        if (!entry) {
            return null;
        }

        if (Date.now() > entry.expiry) {
            this.memoryCache.delete(key);
            return null;
        }

        return entry.data as T;
    }

    /**
     * Set data in cache
     * @param key Cache key
     * @param data Data to cache
     * @param ttl Seconds to live
     */
    async set<T>(key: string, data: T, ttl: number = 300): Promise<void> {
        this.memoryCache.set(key, {
            data,
            expiry: Date.now() + ttl * 1000,
        });
    }

    /**
     * Delete from cache
     */
    async delete(key: string): Promise<void> {
        this.memoryCache.delete(key);
    }

    /**
     * Clear all cache
     */
    async clear(): Promise<void> {
        this.memoryCache.clear();
    }
}
