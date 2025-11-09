import { isForbidden } from '../lib/filter.js';

// Runtime KV adapter: prefer REDIS_URL (ioredis) -> @vercel/kv -> in-memory fallback
async function getKV() {
    if (process.env.REDIS_URL) {
        const mod = await import('ioredis');
        const Redis = mod.default || mod;
        if (!global.__redisClient) {
            global.__redisClient = new Redis(process.env.REDIS_URL);
        }
        const client = global.__redisClient;
        return {
            zrange: async (k, s, e, opts) => {
                if (opts && opts.withScores) {
                    if (opts.rev) return client.zrevrange(k, s, e, 'WITHSCORES');
                    return client.zrange(k, s, e, 'WITHSCORES');
                }
                if (opts && opts.rev) return client.zrevrange(k, s, e);
                return client.zrange(k, s, e);
            },
            zincrby: (k, incr, member) => client.zincrby(k, incr, member),
            zcard: (k) => client.zcard(k),
            zremrangebyrank: (k, a, b) => client.zremrangebyrank(k, a, b),
        };
    }

    try {
        const mod = await import('@vercel/kv');
        return mod.kv;
    } catch (e) {
        // Fallback: simple in-memory store (best-effort, not persistent)
        if (!global.__inMemoryKV) global.__inMemoryKV = new Map();
        const map = global.__inMemoryKV;
        return {
            zrange: async (k, s, e, opts) => {
                const arr = map.get(k) || [];
                if (opts && opts.withScores) {
                    // flatten [member, score, ...]
                    const sliced = arr.slice(s, e + 1).flatMap(item => [item.member, String(item.score)]);
                    return sliced;
                }
                return arr.slice(s, e + 1).map(item => item.member);
            },
            zincrby: async (k, inc, member) => {
                const arr = map.get(k) || [];
                let found = arr.find(i => i.member === member);
                if (!found) { found = { member, score: 0 }; arr.push(found); }
                found.score = Number(found.score) + Number(inc);
                arr.sort((a, b) => b.score - a.score);
                map.set(k, arr);
            },
            zcard: async (k) => (map.get(k) || []).length,
            zremrangebyrank: async (k, a, b) => {
                const arr = map.get(k) || [];
                arr.splice(a, (b - a + 1));
                map.set(k, arr);
            },
        };
    }
}

export default async function handler(request, response) {
    if (request.method === 'GET') {
        try {
            // 获取排名前 30 的热搜词
            const kv = await getKV();
            const searches = await kv.zrange('hot-searches', 0, 29, { withScores: true, rev: true });
            
            const hotSearches = [];
            for (let i = 0; i < searches.length; i += 2) {
                hotSearches.push({
                    term: searches[i],
                    score: searches[i + 1],
                });
            }

            return response.status(200).json({ hotSearches });
        } catch (error) {
            console.error('Error fetching hot searches:', error);
            return response.status(500).json({ error: 'Failed to fetch hot searches.' });
        }
    }

    if (request.method === 'POST') {
        try {
            const { term } = request.body;

            if (!term || typeof term !== 'string' || term.trim().length === 0) {
                return response.status(400).json({ error: 'Search term is required.' });
            }
            
            if (isForbidden(term)) {
                return response.status(200).json({ message: 'Search term processed.' });
            }
            
            const kv = await getKV();
            await kv.zincrby('hot-searches', 1, term.trim());

            // 限制热搜榜的大小为 50
            const count = await kv.zcard('hot-searches');
            if (count > 50) {
                // 移除分数最低的条目，直到数量降至 50
                await kv.zremrangebyrank('hot-searches', 0, count - 51);
            }
            
            return response.status(200).json({ message: 'Search term recorded.' });
        } catch (error) {
            console.error('Error recording search term:', error);
            return response.status(500).json({ error: 'Failed to record search term.' });
        }
    }

    return response.status(405).json({ error: 'Method not allowed.' });
}
