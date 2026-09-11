const { ensureSchema } = require('../config/ensureSchema');

(async () => {
    try {
        console.log('--- Starting Schema Fix Script ---');
        await ensureSchema();
        console.log('--- Schema Fix Script Completed Successfully ---');
        process.exit(0);
    } catch (err) {
        console.error('--- Schema Fix Script Failed ---', err);
        process.exit(1);
    }
})();
