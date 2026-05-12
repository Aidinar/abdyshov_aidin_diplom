const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'mathsense',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'aidin100',
});

async function getTermsPerFile() {
    const res = await pool.query(`
        SELECT f.id AS file_id, array_agg(DISTINCT t.term_text) AS terms
        FROM files f
        JOIN terms t ON f.id = t.file_id
        GROUP BY f.id
    `);
    const map = new Map();
    for (const row of res.rows) {
        map.set(row.file_id, new Set(row.terms));
    }
    return map;
}

function computeIntersections(termsMap) {
    const fileIds = Array.from(termsMap.keys());
    const connections = [];
    for (let i = 0; i < fileIds.length; i++) {
        for (let j = i + 1; j < fileIds.length; j++) {
            const id1 = fileIds[i];
            const id2 = fileIds[j];
            const set1 = termsMap.get(id1);
            const set2 = termsMap.get(id2);
            const intersection = new Set([...set1].filter(x => set2.has(x)));
            if (intersection.size === 0) continue;
            const unionSize = set1.size + set2.size - intersection.size;
            const jaccard = intersection.size / unionSize;
            connections.push({
                file1: id1,
                file2: id2,
                commonTerms: Array.from(intersection),
                commonCount: intersection.size,
                jaccard
            });
        }
    }
    return connections;
}

async function updateConnectionsCache(connections) {
    for (const conn of connections) {
        await pool.query(`
            INSERT INTO file_connections (file1_id, file2_id, common_terms_count, common_terms_list, jaccard_index)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (file1_id, file2_id) DO UPDATE SET
                common_terms_count = EXCLUDED.common_terms_count,
                common_terms_list = EXCLUDED.common_terms_list,
                jaccard_index = EXCLUDED.jaccard_index,
                created_at = CURRENT_TIMESTAMP
        `, [conn.file1, conn.file2, conn.commonCount, conn.commonTerms, conn.jaccard]);
    }
}

async function getGlobalGraph(forceRefresh = false) {
    if (!forceRefresh) {
        const cached = await pool.query(`
            SELECT file1_id, file2_id, common_terms_count, common_terms_list, jaccard_index
            FROM file_connections
        `);
        if (cached.rows.length > 0) {
            return cached.rows.map(row => ({
                source: row.file1_id,
                target: row.file2_id,
                weight: row.common_terms_count,
                terms: row.common_terms_list,
                jaccard: row.jaccard_index
            }));
        }
    }
    const termsMap = await getTermsPerFile();
    const connections = computeIntersections(termsMap);
    await updateConnectionsCache(connections);
    return connections.map(conn => ({
        source: conn.file1,
        target: conn.file2,
        weight: conn.commonCount,
        terms: conn.commonTerms,
        jaccard: conn.jaccard
    }));
}

async function getFileConnections(fileId) {
    const res = await pool.query(`
        SELECT 
            CASE WHEN file1_id = $1 THEN file2_id ELSE file1_id END AS connected_file_id,
            common_terms_count,
            common_terms_list,
            jaccard_index
        FROM file_connections
        WHERE file1_id = $1 OR file2_id = $1
        ORDER BY common_terms_count DESC
    `, [fileId]);
    return res.rows;
}

async function recommendFilesByTerms(terms) {
    if (!terms.length) return [];
    const placeholders = terms.map((_, idx) => `$${idx + 1}`).join(',');
    const query = `
        SELECT DISTINCT f.id, f.filename, COUNT(t.term_text) AS match_count
        FROM files f
        JOIN terms t ON f.id = t.file_id
        WHERE t.term_text IN (${placeholders})
        GROUP BY f.id
        ORDER BY match_count DESC
        LIMIT 10
    `;
    const res = await pool.query(query, terms);
    return res.rows;
}

module.exports = {
    getGlobalGraph,
    getFileConnections,
    recommendFilesByTerms,
    updateConnectionsCache
};