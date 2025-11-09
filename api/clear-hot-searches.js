// Use runtime KV adapter to support REDIS_URL or @vercel/kv
async function getKV() {
    if (process.env.REDIS_URL) {
        const mod = await import('ioredis');
        const Redis = mod.default || mod;
        if (!global.__redisClient) global.__redisClient = new Redis(process.env.REDIS_URL);
        const client = global.__redisClient;
        return {
            del: (k) => client.del(k),
        };
    }

    try {
        const mod = await import('@vercel/kv');
        return mod.kv;
    } catch (e) {
        if (!global.__inMemoryKV) global.__inMemoryKV = new Map();
        return {
            del: async (k) => global.__inMemoryKV.delete(k),
        };
    }
}

export default async function handler(request, response) {
    if (request.method === 'POST') {
        try {
            const { password } = request.body;
            const expectedPassword = process.env.CLEAR_PASSWORD;

            if (!expectedPassword) {
                return response.status(500).json({ error: 'Password not configured on server.' });
            }

            if (password !== expectedPassword) {
                return response.status(401).json({ error: 'Invalid password.' });
            }

            const kv = await getKV();
            await kv.del('hot-searches');
            return response.status(200).json({ message: 'Hot searches cleared.' });
        } catch (error) {
            console.error('Error clearing hot searches:', error);
            return response.status(500).json({ error: 'Failed to clear hot searches.' });
        }
    }

    return response.status(405).json({ error: 'Method not allowed.' });
}
