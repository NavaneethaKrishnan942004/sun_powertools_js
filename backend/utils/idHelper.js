/**
 * Helper to get the next sequential ID for a table.
 * Used as a resilient fallback in environments (like TiDB Cloud) where tables
 * might temporarily lack AUTO_INCREMENT or strict mode rejects inserts without 'id'.
 * 
 * @param {Object} dbOrConn - MySQL pool or active connection
 * @param {string} tableName - Target table name
 * @returns {Promise<number>} - Next ID to use
 */
async function getNextId(dbOrConn, tableName) {
    try {
        const [rows] = await dbOrConn.query(`SELECT COALESCE(MAX(id), 0) + 1 AS nextId FROM \`${tableName}\``);
        return parseInt(rows[0].nextId, 10);
    } catch (err) {
        console.error(`[idHelper] Failed to fetch nextId for '${tableName}':`, err.message);
        throw err;
    }
}

module.exports = { getNextId };
