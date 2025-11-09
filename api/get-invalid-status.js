// Runtime KV adapter supporting REDIS_URL or @vercel/kv
async function getKV() {
    if (process.env.REDIS_URL) {
        const mod = await import('ioredis');
        const Redis = mod.default || mod;
        if (!global.__redisClient) global.__redisClient = new Redis(process.env.REDIS_URL);
        const client = global.__redisClient;
        return {
            zmscore: (key, ...members) => client.zmscore ? client.zmscore(key, ...members) : Promise.resolve(members.map(() => null)),
            zrange: (k, s, e, opts) => {
                if (opts && opts.withScores) return client.zrange(k, s, e, 'WITHSCORES');
                return client.zrange(k, s, e);
            }
        };
    }

    try {
        const mod = await import('@vercel/kv');
        return mod.kv;
    } catch (e) {
        if (!global.__inMemoryKV) global.__inMemoryKV = new Map();
        return {
            zmscore: async (key, ...members) => members.map(() => null),
            zrange: async (k, s, e, opts) => []
        };
    }
}

export default async function handler(request, response) {
    if (request.method !== 'POST') {
        return response.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    const { urls } = request.body;

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
        return response.status(400).json({ success: false, message: 'An array of resource URLs is required' });
    }

    try {
        const invalidStatus = {};
        const kv = await getKV();

        // 优先尝试使用 zmscore（如果可用）
        let scores = [];
        try {
            scores = await kv.zmscore('invalid-resources', ...urls);
        } catch (e) {
            scores = urls.map(() => null);
        }

        const isZmscoreWorking = Array.isArray(scores) && scores.some(score => score !== null);

        if (isZmscoreWorking) {
            for (let i = 0; i < urls.length; i++) {
                const score = scores[i];
                if (score && score >= 3) invalidStatus[urls[i]] = true;
            }
        } else {
            // 回退到 zrange
            const allInvalid = await kv.zrange('invalid-resources', 0, -1, { withScores: true });
            const invalidMap = {};
            for (let i = 0; i < allInvalid.length; i += 2) {
                const url = allInvalid[i];
                const score = Number(allInvalid[i + 1] || 0);
                if (score >= 3) invalidMap[url] = true;
            }
            for (const url of urls) {
                if (invalidMap[url]) invalidStatus[url] = true;
            }
        }

        return response.status(200).json({ success: true, invalidStatus });
    } catch (error) {
        console.error('Error getting invalid status:', error);
        return response.status(500).json({ success: false, message: 'Internal Server Error' });
    }
}
