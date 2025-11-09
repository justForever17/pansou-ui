// Runtime KV adapter supporting REDIS_URL or @vercel/kv
async function getKV() {
    if (process.env.REDIS_URL) {
        const mod = await import('ioredis');
        const Redis = mod.default || mod;
        if (!global.__redisClient) global.__redisClient = new Redis(process.env.REDIS_URL);
        const client = global.__redisClient;
        return {
            keys: (pattern) => client.keys(pattern),
            get: (k) => client.get(k),
        };
    }

    try {
        const mod = await import('@vercel/kv');
        return mod.kv;
    } catch (e) {
        if (!global.__inMemoryKV) global.__inMemoryKV = new Map();
        return {
            keys: async (pattern) => Array.from(global.__inMemoryKV.keys()).filter(k => k.startsWith(pattern.replace('*',''))),
            get: async (k) => global.__inMemoryKV.get(k),
        };
    }
}
import fs from 'fs/promises';
import path from 'path';
import matter from 'gray-matter';

export default async function handler(request, response) {
    if (request.method !== 'GET') {
        return response.status(405).json({ error: 'Method not allowed.' });
    }

    try {
    // Get all view counts from KV
    const kv = await getKV();
    const keys = await kv.keys('views:*');
        console.log('DEBUG: Found keys in KV:', keys);
        const allViews = {};

        for (const key of keys) {
            const collectionId = key.replace('views:', '');
            const views = await kv.get(key) || 0;
            console.log(`DEBUG: Key: ${key}, Collection ID: ${collectionId}, Views: ${views}`);
            allViews[collectionId] = views;
        }

        console.log('DEBUG: Final allViews object:', allViews);
        return response.status(200).json(allViews);

    } catch (error) {
        console.error('Error getting all views:', error);
        return response.status(500).json({ error: 'Failed to get all views.' });
    }
}
