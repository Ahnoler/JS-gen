/**
 * Database connection manager — knex + mysql2.
 *
 * Singleton pattern: call getDB() to obtain the knex instance.
 * Call closeDB() during server shutdown to release the pool.
 */
import knexLib from 'knex';
import { resolve } from './config.js';

let knexInstance;

/**
 * 获取 knex 单例实例（首次调用时按 config/.env 创建连接池）。
 * @returns {import('knex').Knex} knex 实例（mysql2 client）
 */
export function getDB() {
  if (!knexInstance) {
    knexInstance = knexLib({
      client: 'mysql2',
      connection: {
        host: resolve('DB_HOST', '127.0.0.1'),
        port: parseInt(resolve('DB_PORT', '3306'), 10),
        user: resolve('DB_USER', 'root'),
        password: resolve('DB_PASS', ''),
        database: resolve('DB_NAME', 'js_gen'),
        charset: 'utf8mb4',
      },
      pool: {
        min: parseInt(resolve('DB_POOL_MIN', '2'), 10),
        max: parseInt(resolve('DB_POOL_MAX', '10'), 10),
        idleTimeoutMillis: 30000,
      },
      acquireConnectionTimeout: 10000,
    });
  }
  return knexInstance;
}

/**
 * 关闭并释放 knex 连接池（服务停机时调用）。
 * @returns {Promise<void>}
 */
export async function closeDB() {
  if (knexInstance) {
    await knexInstance.destroy();
    knexInstance = null;
  }
}
