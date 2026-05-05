const { Client } = require('pg')
require('dotenv').config()

async function setupDatabase() {
    const client = new Client({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: 'postgres'
    })

    try {
        await client.connect()
        console.log(' Подключено к PostgreSQL')

        // Создаём БД
        await client.query('CREATE DATABASE mathsense')
        console.log(' База данных mathsense создана')

        // Подключаемся к новой БД
        const dbClient = new Client({
            host: process.env.DB_HOST,
            port: process.env.DB_PORT,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: 'mathsense'
        })

        await dbClient.connect()

        // Создаём таблицы
        await dbClient.query(`
            CREATE TABLE IF NOT EXISTS files (
                id SERIAL PRIMARY KEY,
                filename VARCHAR(255) NOT NULL,
                file_size INTEGER,
                upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                total_terms INTEGER DEFAULT 0
            );
            
            CREATE TABLE IF NOT EXISTS terms (
                id SERIAL PRIMARY KEY,
                file_id INTEGER REFERENCES files(id) ON DELETE CASCADE,
                term_text VARCHAR(255) NOT NULL,
                term_definition TEXT,
                term_lang VARCHAR(10),
                context TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            
            CREATE INDEX IF NOT EXISTS idx_terms_text ON terms(term_text);
            CREATE INDEX IF NOT EXISTS idx_terms_file ON terms(file_id);
            
            CREATE TABLE IF NOT EXISTS file_connections (
                id SERIAL PRIMARY KEY,
                file1_id INTEGER REFERENCES files(id) ON DELETE CASCADE,
                file2_id INTEGER REFERENCES files(id) ON DELETE CASCADE,
                common_terms_count INTEGER NOT NULL,
                common_terms_list TEXT[],
                jaccard_index FLOAT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(file1_id, file2_id)
            );

            CREATE INDEX IF NOT EXISTS idx_connections_file1 ON file_connections(file1_id);
            CREATE INDEX IF NOT EXISTS idx_connections_file2 ON file_connections(file2_id);

            
        `)

        console.log(' Таблицы созданы')
        console.log(' База готова!')

        await dbClient.end()

    } catch (error) {
        if (error.message.includes('already exists')) {
            console.log(' База данных mathsense уже существует')
        } else {
            console.error(' Ошибка:', error.message)
        }
    } finally {
        await client.end()
    }
}

setupDatabase()