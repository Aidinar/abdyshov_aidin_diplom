const express = require('express')
const { Pool } = require('pg')
const cors = require('cors')
const dotenv = require('dotenv')

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3001

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'mathsense',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'admin100',
    connectionTimeoutMillis: 5000,
})

app.use(cors())
app.use(express.json())

app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'Server is running' })
})
app.post('/api/analyze/save', async (req, res) => {
    const { filename, fileSize, terms } = req.body

    console.log(' Получен запрос:', { filename, termsCount: terms?.length })

    if (!filename || !terms || !Array.isArray(terms)) {
        return res.status(400).json({ error: 'Неверные данные' })
    }

    try {
        const fileResult = await pool.query(
            `INSERT INTO files (filename, file_size, total_terms) 
             VALUES ($1, $2, $3) RETURNING id`,
            [filename, fileSize || null, terms.length]
        )

        const fileId = fileResult.rows[0].id
        for (const term of terms) {
            await pool.query(
                `INSERT INTO terms (file_id, term_text, term_definition, term_lang, context) 
                 VALUES ($1, $2, $3, $4, $5)`,
                [fileId, term.text, term.definition, term.lang, term.context]
            )
        }

        console.log(` Сохранено: файл ${fileId}, терминов ${terms.length}`)

        res.json({
            success: true,
            fileId: fileId,
            totalTerms: terms.length
        })

    } catch (error) {
        console.error(' Ошибка БД:', error.message)
        res.status(500).json({ error: error.message })
    }
})

// Статистика
app.get('/api/stats', async (req, res) => {
    try {
        const filesCount = await pool.query('SELECT COUNT(*) FROM files')
        const termsCount = await pool.query('SELECT COUNT(*) FROM terms')

        res.json({
            total_files: parseInt(filesCount.rows[0].count),
            total_terms: parseInt(termsCount.rows[0].count)
        })
    } catch (error) {
        console.error(' Ошибка статистики:', error.message)
        res.status(500).json({ error: error.message })
    }
})

// История
app.get('/api/files/history', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, filename, file_size, upload_date, total_terms 
             FROM files 
             ORDER BY upload_date DESC 
             LIMIT 50`
        )
        res.json({ files: result.rows })
    } catch (error) {
        console.error(' Ошибка истории:', error.message)
        res.status(500).json({ error: error.message })
    }
})

const ai = require('./aiConnector');

// Получить все файлы 
app.get('/api/files/all', async (req, res) => {
    try {
        const result = await pool.query('SELECT id, filename, upload_date FROM files ORDER BY upload_date DESC');
        res.json({ files: result.rows });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: err.message });
    }
});

// Глобальный граф связей
app.get('/api/graph/global', async (req, res) => {
    try {
        const forceRefresh = req.query.refresh === 'true';
        const edges = await ai.getGlobalGraph(forceRefresh);
        res.json({ edges });
    } catch (err) {
        console.error('Ошибка построения графа:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Связи конкретного файла
app.get('/api/graph/file/:id/connections', async (req, res) => {
    try {
        const fileId = parseInt(req.params.id);
        const connections = await ai.getFileConnections(fileId);
        const fileNames = {};
        for (const conn of connections) {
            const id = conn.connected_file_id;
            if (!fileNames[id]) {
                const fileRes = await pool.query('SELECT filename FROM files WHERE id = $1', [id]);
                fileNames[id] = fileRes.rows[0]?.filename || 'unknown';
            }
        }
        res.json({ connections, fileNames });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: err.message });
    }
});

// Рекомендации 
app.post('/api/ai/recommend', async (req, res) => {
    const { terms } = req.body;
    if (!terms || !Array.isArray(terms)) {
        return res.status(400).json({ error: 'Необходим массив terms' });
    }
    try {
        const recommendations = await ai.recommendFilesByTerms(terms);
        res.json({ recommendations });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, async () => {
    console.log(` Сервер на http://localhost:${PORT}`)

    // Проверка подключения к БД
    try {
        const result = await pool.query('SELECT NOW()')
        console.log(' PostgreSQL подключена на порту', process.env.DB_PORT || 5432)
        console.log(' Время на сервере БД:', result.rows[0].now)
    } catch (err) {
        console.error(' Ошибка подключения к PostgreSQL:', err.message)
        console.log('\n💡 Проверьте:')
        console.log('   1. Запущен ли PostgreSQL? (да, порт 5432 слушает)')
        console.log('   2. Правильный ли пароль в .env? (должен быть admin100)')
        console.log('   3. Существует ли база "mathsense"?')
    }
})