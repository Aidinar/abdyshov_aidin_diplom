const express = require('express')
const { Pool } = require('pg')
const cors = require('cors')
const dotenv = require('dotenv')
const axios = require('axios')

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3001

app.use(cors())
app.use(express.json())

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'mathsense',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'aidin100',
    connectionTimeoutMillis: 5000,
})

let ontologyCache = null
let ontologyCacheTime = null
const CACHE_TTL = 5 * 60 * 1000

    -
    app.get('/api/health', (req, res) => {
        res.json({ status: 'OK', message: 'Server is running' })
    })

// --- Онтология из GraphDB ---
app.get('/api/ontology/terms', async (req, res) => {
    try {
        if (ontologyCache && ontologyCacheTime && (Date.now() - ontologyCacheTime) < CACHE_TTL) {
            return res.json(ontologyCache)
        }

        const graphdbUrl = process.env.GRAPHDB_URL || 'http://localhost:7200/repositories/mathsense-ontology2'
        const sparqlQuery = `
            PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
            SELECT DISTINCT ?label ?comment ?uri WHERE {
                ?uri rdfs:label ?label .
                OPTIONAL { ?uri rdfs:comment ?comment }
            }
            LIMIT 10000
        `

        const response = await axios({
            method: 'post',
            url: graphdbUrl,
            headers: {
                'Accept': 'application/sparql-results+json',
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            data: new URLSearchParams({ query: sparqlQuery }).toString()
        })

        const results = response.data.results.bindings
        const terms = []

        for (const binding of results) {
            let label = binding.label?.value || ''
            const comment = binding.comment?.value || 'Определение отсутствует'
            const uri = binding.uri?.value || ''

            let lang = 'ru'
            if (label.includes('@en')) lang = 'en'
            else if (label.includes('@ru')) lang = 'ru'

            const cleanLabel = label.replace(/@[a-z]+$/, '')
            terms.push({
                label: cleanLabel,
                definition: comment,
                lang: lang,
                uri: uri
            })
        }

        ontologyCache = terms
        ontologyCacheTime = Date.now()
        res.json(terms)
    } catch (error) {
        console.error('GraphDB error:', error.message)
        res.status(500).json({ error: 'Не удалось загрузить онтологию из GraphDB' })
    }
})



app.post('/api/analyze/save', async (req, res) => {
    const { filename, fileSize, terms } = req.body
    console.log('📥 Получен запрос:', { filename, termsCount: terms?.length })

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
        res.json({ success: true, fileId, totalTerms: terms.length })
    } catch (error) {
        console.error(' Ошибка БД:', error.message)
        res.status(500).json({ error: error.message })
    }
})

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

app.get('/api/files/all', async (req, res) => {
    try {
        const result = await pool.query('SELECT id, filename, upload_date FROM files ORDER BY upload_date DESC')
        res.json({ files: result.rows })
    } catch (err) {
        console.error(err.message)
        res.status(500).json({ error: err.message })
    }
})


const ai = require('./aiConnector')

app.get('/api/graph/global', async (req, res) => {
    try {
        const forceRefresh = req.query.refresh === 'true'
        const edges = await ai.getGlobalGraph(forceRefresh)
        res.json({ edges })
    } catch (err) {
        console.error('Ошибка построения графа:', err.message)
        res.status(500).json({ error: err.message })
    }
})

app.get('/api/graph/file/:id/connections', async (req, res) => {
    try {
        const fileId = parseInt(req.params.id)
        const connections = await ai.getFileConnections(fileId)
        const fileNames = {}
        for (const conn of connections) {
            const id = conn.connected_file_id
            if (!fileNames[id]) {
                const fileRes = await pool.query('SELECT filename FROM files WHERE id = $1', [id])
                fileNames[id] = fileRes.rows[0]?.filename || 'unknown'
            }
        }
        res.json({ connections, fileNames })
    } catch (err) {
        console.error(err.message)
        res.status(500).json({ error: err.message })
    }
})

// Рекомендации по списку терминов
app.post('/api/ai/recommend', async (req, res) => {
    const { terms } = req.body
    if (!terms || !Array.isArray(terms)) {
        return res.status(400).json({ error: 'Необходим массив terms' })
    }
    try {
        const recommendations = await ai.recommendFilesByTerms(terms)
        res.json({ recommendations })
    } catch (err) {
        console.error(err.message)
        res.status(500).json({ error: err.message })
    }
})

// ========== LLM через Ollama ==========

function extractTermFromQuestion(question) {
    let clean = question.toLowerCase().replace(/[?؟!.]/g, '').trim();
    const stopPhrases = [
        'что такое', 'определение', 'что значит', 'расскажи', 'объясни',
        'является ли', 'правда ли что', 'верно ли что', 'это правда?'
    ];
    for (const phrase of stopPhrases) {
        if (clean.startsWith(phrase)) {
            clean = clean.slice(phrase.length).trim();
            break;
        }
    }
    clean = clean.replace(/\s+это правда\??$/, '').trim();
    const words = clean.split(/\s+/).filter(w => w.length > 2 && !['или', 'и', 'да', 'нет', 'но', 'зато', 'также', 'который', 'является'].includes(w));
    if (words.length === 0) return null;
    return words.slice(0, 3).join(' ');
}

// Поиск определения в кэше онтологии
function findDefinitionInOntology(term) {
    if (!ontologyCache || !Array.isArray(ontologyCache)) return null;
    const lowerTerm = term.toLowerCase();
    let found = ontologyCache.find(t => t.label.toLowerCase() === lowerTerm);
    if (found) return found.definition;
    found = ontologyCache.find(t => t.label.toLowerCase().includes(lowerTerm) || lowerTerm.includes(t.label.toLowerCase()));
    return found ? found.definition : null;
}

app.post('/api/llm/ask', async (req, res) => {
    const { question } = req.body;
    if (!question || typeof question !== 'string') {
        return res.status(400).json({ error: 'Вопрос не указан' });
    }

    try {
        const term = extractTermFromQuestion(question);
        if (!term) {
            return res.json({ answer: 'Не могу понять, о каком математическом понятии идёт речь. Переформулируйте вопрос, например: "Что такое интеграл?"' });
        }

        let definition = findDefinitionInOntology(term);
        if (!definition) {
            return res.json({ answer: `Извините, понятие «${term}» не найдено в онтологии OntoMathPRO. Попробуйте другое слово.` });
        }
        let ollamaAvailable = false;
        try {
            await axios.get('http://localhost:11434/api/tags', { timeout: 500 });
            ollamaAvailable = true;
        } catch (e) {
            console.log('Ollama не доступен, используем fallback.');
        }

        let answer = '';
        if (ollamaAvailable) {
            const prompt = `Ты — математический ассистент. Используй ТОЛЬКО следующее определение из онтологии:
Определение термина "${term}": ${definition}

Теперь ответь на вопрос пользователя: "${question}"
Ответ должен быть подробным, понятным и основанным строго на определении выше. Не добавляй выдуманных фактов.`;

            const response = await axios.post('http://localhost:11434/api/generate', {
                model: 'llama3.2:1b',
                prompt: prompt,
                stream: false,
                options: { temperature: 0.3, max_tokens: 300 }
            });
            answer = response.data.response.trim();
        } else {
            answer = `Согласно онтологии, ${term} — это ${definition}`;
        }

        res.json({ answer, term, definition });

    } catch (error) {
        console.error('Ошибка в /api/llm/ask:', error.message);
        const term = extractTermFromQuestion(req.body.question);
        const definition = term ? findDefinitionInOntology(term) : null;
        if (definition) {
            return res.json({ answer: `Согласно онтологии, ${term} — это ${definition}`, term, definition });
        }
        res.status(500).json({ error: 'Не удалось обработать запрос. Проверьте, запущен ли Ollama.' });
    }
});
// ========== 5. ЗАПУСК СЕРВЕРА ==========
app.listen(PORT, async () => {
    console.log(` Сервер запущен на http://localhost:${PORT}`)
    try {
        const result = await pool.query('SELECT NOW()')
        console.log(' PostgreSQL подключена на порту', process.env.DB_PORT || 5432)
        console.log(' Время на сервере БД:', result.rows[0].now)
    } catch (err) {
        console.error(' Ошибка подключения к PostgreSQL:', err.message)
        console.log('\n Проверьте:')
        console.log('   1. Запущен ли PostgreSQL?')
        console.log('   2. Правильный ли пароль в .env?')
        console.log('   3. Существует ли база "mathsense"?')
    }
})