// Runtime KV adapter supporting REDIS_URL or @vercel/kv
async function getKV() {
    if (process.env.REDIS_URL) {
        const mod = await import('ioredis');
        const Redis = mod.default || mod;
        if (!global.__redisClient) global.__redisClient = new Redis(process.env.REDIS_URL);
        const client = global.__redisClient;
        return {
            zincrby: (k, inc, member) => client.zincrby(k, inc, member),
        };
    }

    try {
        const mod = await import('@vercel/kv');
        return mod.kv;
    } catch (e) {
        if (!global.__inMemoryKV) global.__inMemoryKV = new Map();
        return {
            zincrby: async (k, inc, member) => {
                const arr = global.__inMemoryKV.get(k) || [];
                let found = arr.find(i => i.member === member);
                if (!found) { found = { member, score: 0 }; arr.push(found); }
                found.score = Number(found.score) + Number(inc);
                arr.sort((a, b) => b.score - a.score);
                global.__inMemoryKV.set(k, arr);
            },
        };
    }
}

export default async function handler(request, response) {
    if (request.method !== 'POST') {
        return response.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    const { url } = request.body;

    if (!url) {
        return response.status(400).json({ success: false, message: 'Resource URL is required' });
    }

    try {
    const kv = await getKV();
    await kv.zincrby('invalid-resources', 1, url);

        return response.status(200).json({ success: true, message: 'Resource marked as invalid.' });
    } catch (error) {
        console.error('Error marking resource as invalid:', error);
        return response.status(500).json({ success: false, message: 'Internal Server Error' });
    }
}
