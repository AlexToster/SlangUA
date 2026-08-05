"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRedisClient = getRedisClient;
exports.connectRedis = connectRedis;
exports.disconnectRedis = disconnectRedis;
const ioredis_1 = __importDefault(require("ioredis"));
const index_js_1 = require("../config/index.js");
let redisClient = null;
function getRedisClient() {
    if (!redisClient) {
        redisClient = new ioredis_1.default(index_js_1.config.REDIS_URL, {
            maxRetriesPerRequest: 3,
            retryStrategy: (times) => {
                if (times > 3) {
                    return null; // Stop retrying
                }
                return Math.min(times * 200, 2000);
            },
            lazyConnect: true,
        });
        redisClient.on('error', (err) => {
            console.error('Redis connection error:', err);
        });
        redisClient.on('connect', () => {
            console.log('Redis connected');
        });
    }
    return redisClient;
}
async function connectRedis() {
    const client = getRedisClient();
    if (client.status === 'wait') {
        await client.connect();
    }
}
async function disconnectRedis() {
    if (redisClient) {
        await redisClient.quit();
        redisClient = null;
    }
}
//# sourceMappingURL=redis.js.map