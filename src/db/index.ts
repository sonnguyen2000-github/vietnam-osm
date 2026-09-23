import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.ts';

declare global {
  var _postgresPool: Pool | undefined;
}

export const createPool = () => {
  if (!global._postgresPool) {
    const connectionString = process.env.DATABASE_URL;
    const poolConfig = connectionString
      ? {
          connectionString,
          max: 10,
          connectionTimeoutMillis: 15000,
        }
      : {
          host: process.env.SQL_HOST || process.env.PGHOST || 'localhost',
          user: process.env.SQL_USER || process.env.PGUSER || 'postgres',
          password: process.env.SQL_PASSWORD || process.env.PGPASSWORD,
          database: process.env.SQL_DB_NAME || process.env.PGDATABASE || 'osm_vietnam',
          port: process.env.SQL_PORT ? Number(process.env.SQL_PORT) : process.env.PGPORT ? Number(process.env.PGPORT) : 5432,
          max: 10,
          connectionTimeoutMillis: 15000,
        };

    global._postgresPool = new Pool(poolConfig);

    global._postgresPool.on('error', (err) => {
      console.error('Unexpected error on idle SQL pool client:', err);
    });
  }
  return global._postgresPool;
};

const pool = createPool();

export const db = drizzle(pool, { schema });
