// Runtime KV adapter
async function getKV() {
    if (process.env.REDIS_URL) {
        const mod = await import('ioredis');
        const Redis = mod.default || mod;
        if (!global.__redisClient) global.__redisClient = new Redis(process.env.REDIS_URL);
        const client = global.__redisClient;
        return {
            zrem: (k, member) => client.zrem(k, member),
        };
    }

    try {
        const mod = await import('@vercel/kv');
        return mod.kv;
    } catch (e) {
        if (!global.__inMemoryKV) global.__inMemoryKV = new Map();
        return {
            zrem: async (k, member) => {
                const arr = global.__inMemoryKV.get(k) || [];
                const idx = arr.findIndex(i => i.member === member);
                if (idx >= 0) { arr.splice(idx, 1); global.__inMemoryKV.set(k, arr); return 1; }
                return 0;
            },
        };
    }
}

export default async function handler(request, response) {
    if (request.method !== 'POST') {
        return response.status(405).json({ error: 'Method not allowed.' });
    }

    try {
        const { password, term } = request.body;

        // Password validation, same as clear-hot-searches
        const expectedPassword = process.env.CLEAR_PASSWORD;
        if (!expectedPassword) {
            return response.status(500).json({ error: 'Password not configured on server.' });
        }
        if (password !== expectedPassword) {
            return response.status(401).json({ error: 'Invalid password.' });
        }

        // Term validation
        if (!term || typeof term !== 'string' || term.trim().length === 0) {
            return response.status(400).json({ error: 'Search term to delete is required.' });
        }

        // Delete the term from the sorted set
    const kv = await getKV();
    const result = await kv.zrem('hot-searches', term.trim());

        if (result > 0) {
            return response.status(200).json({ message: `Hot search term "${term}" deleted.` });
        } else {
            return response.status(404).json({ error: `Hot search term "${term}" not found.` });
        }

    } catch (error) {
        console.error('Error deleting hot search term:', error);
        return response.status(500).json({ error: 'Failed to delete hot search term.' });
    }
}
