import { Pool, QueryResult } from 'pg';
import * as dotenv from 'dotenv';
import { logger } from './logger';

dotenv.config(); // Load .env variables

// Configure and create the PostgreSQL connection pool
export const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false // Basic SSL for production
});

// (Optional) pool error handler
pool.on('error', (err, client) => {
    logger.log({ level: 'error', message: `Unexpected error on idle PostgreSQL client ${err}` });
});

// Init DB - create table if it doesn't exist
export async function initializeDatabase(): Promise<void> {
    const client = await pool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS user_push_tokens (
                user_id VARCHAR(255) PRIMARY KEY,
                push_token TEXT NOT NULL,
                updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            );
        `);
        logger.log({ level: 'info', message: 'Database table "user_push_tokens" checked/created.' });
    } catch (err) {
        logger.log({ level: 'error', message: `Error initializing database table: ${err}` });
        throw err; // Re-throw to prevent server start on critical DB error
    } finally {
        client.release(); // Release the client back to the pool
    }
}

// TODO: rename to 'upsert'
export async function saveOrUpdatePushToken(userId: string, pushToken: string): Promise<void> {
    const query = `
        INSERT INTO user_push_tokens (user_id, push_token, updated_at)
        VALUES ($1, $2, CURRENT_TIMESTAMP)
        ON CONFLICT (user_id)
        DO UPDATE SET push_token = EXCLUDED.push_token, updated_at = CURRENT_TIMESTAMP;
    `;
    try {
        await pool.query(query, [userId, pushToken]);
        logger.log({ level: 'info', message: `DB: Push token saved/updated for user: ${userId}` });
    } catch (error) {
        logger.log({ level: 'error', message: `DB Error: Failed saving push token for user ${userId}: ${error}` });
        throw error; // Re-throw to be handled by the caller
    }
}

export async function getPushToken(userId: string): Promise<string | null> {
    const query = 'SELECT push_token FROM user_push_tokens WHERE user_id = $1';
    try {
        const result: QueryResult<{ push_token: string }> = await pool.query(query, [userId]);
        if (result.rows.length > 0) {
            logger.log({ level: 'info', message: `DB: Found push token for user ${userId}` });
            return result.rows[0].push_token;
        }
        logger.log({ level: 'info', message: `DB: No push token found for user ${userId}` });
        return null; // User not found or no token registered
    } catch (error) {
        logger.log({ level: 'error', message: `DB Error: Failed retrieving push token for user ${userId}: ${error}` });
        throw error; // Re-throw
    }
}

// Closing the database pool gracefully
export async function closeDbPool(): Promise<void> {
    logger.log({ level: 'info', message: 'Closing PostgreSQL connection pool...' });
    try {
        await pool.end();
        logger.log({ level: 'info', message: 'PostgreSQL pool has been closed.' });
    } catch (error) {
        logger.log({ level: 'error', message: `Error closing PostgreSQL pool: ${error}` });
    }
}
