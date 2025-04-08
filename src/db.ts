import { Pool, QueryResult } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config(); // Load .env variables

// Configure and create the PostgreSQL connection pool
export const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false // Basic SSL for production
});

// (Optional) pool error handler
pool.on('error', (err, client) => {
    console.error('Unexpected error on idle PostgreSQL client', err);
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
        console.log('Database table "user_push_tokens" checked/created.');
    } catch (err) {
        console.error('Error initializing database table:', err);
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
        console.log(`DB: Push token saved/updated for user: ${userId}`);
    } catch (error) {
        console.error(`DB Error: Failed saving push token for user ${userId}:`, error);
        throw error; // Re-throw to be handled by the caller
    }
}

export async function getPushToken(userId: string): Promise<string | null> {
    const query = 'SELECT push_token FROM user_push_tokens WHERE user_id = $1';
    try {
        const result: QueryResult<{ push_token: string }> = await pool.query(query, [userId]);
        if (result.rows.length > 0) {
            console.log(`DB: Found push token for user ${userId}`);
            return result.rows[0].push_token;
        }
        console.log(`DB: No push token found for user ${userId}`);
        return null; // User not found or no token registered
    } catch (error) {
        console.error(`DB Error: Failed retrieving push token for user ${userId}:`, error);
        throw error; // Re-throw
    }
}

// Closing the database pool gracefully
export async function closeDbPool(): Promise<void> {
    console.log('Closing PostgreSQL connection pool...');
    try {
        await pool.end();
        console.log('PostgreSQL pool has been closed.');
    } catch (error) {
        console.error('Error closing PostgreSQL pool:', error);
    }
}
