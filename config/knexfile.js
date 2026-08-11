/**
 * Knex configuration for migrations and seeds.
 *
 * Usage:
 *   npx knex migrate:make <name> --knexfile config/knexfile.js
 *   npx knex migrate:latest --knexfile config/knexfile.js
 *   npx knex seed:run --knexfile config/knexfile.js
 */
import { resolve } from './config.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

/** Keep defaults in sync with config/database.js and schemas/init.sql */
export default {
  client: 'mysql2',
  connection: {
    host: resolve('DB_HOST', '127.0.0.1'),
    port: parseInt(resolve('DB_PORT', '3306'), 10),
    user: resolve('DB_USER', 'root'),
    password: resolve('DB_PASS', ''),
    database: resolve('DB_NAME', 'js_gen'),
    charset: 'utf8mb4',
  },
  migrations: {
    directory: path.join(ROOT, 'migrations'),
    extension: 'js',
  },
  seeds: {
    directory: path.join(ROOT, 'seeds'),
  },
};
