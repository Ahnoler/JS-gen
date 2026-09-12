/**
 * Database connection manager — knex + mysql2.
 *
 * Singleton pattern: call getDB() to obtain the knex instance.
 * Call closeDB() during server shutdown to release the pool.
 */
import knexLib from 'knex';
import mysql from 'mysql2/promise';
import { resolve } from './config.js';

let knexInstance;

function getConnectionConfig() {
  return {
    host: resolve('DB_HOST', '127.0.0.1'),
    port: parseInt(resolve('DB_PORT', '3306'), 10),
    user: resolve('DB_USER', 'root'),
    password: resolve('DB_PASS', ''),
    database: resolve('DB_NAME', 'js_gen'),
    charset: 'utf8mb4',
    connectTimeout: parseInt(resolve('DB_CONNECT_TIMEOUT_MS', '5000'), 10),
    compress: true,
  };
}

/**
 * 获取 knex 单例实例（首次调用时按 config/.env 创建连接池）。
 * @returns {import('knex').Knex} knex 实例（mysql2 client）
 */
export function getDB() {
  if (!knexInstance) {
    knexInstance = knexLib({
      client: 'mysql2',
      connection: getConnectionConfig(),
      pool: {
        // Do not open remote connections during module/startup initialization.
        min: parseInt(resolve('DB_POOL_MIN', '0'), 10),
        max: parseInt(resolve('DB_POOL_MAX', '10'), 10),
        idleTimeoutMillis: 30000,
      },
      acquireConnectionTimeout: parseInt(resolve('DB_ACQUIRE_TIMEOUT_MS', '5000'), 10),
    });
  }
  return knexInstance;
}

/**
 * 检查数据库当前是否可连接。
 * @returns {Promise<boolean>} 数据库可用时返回 true
 */
export async function checkDBConnection() {
  let connection;
  try {
    connection = await mysql.createConnection(getConnectionConfig());
    await connection.query('select 1');
    return true;
  } catch {
    return false;
  } finally {
    await connection?.end().catch(() => {});
  }
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
