'use strict';

const path = require('node:path');
const { createApp } = require('./src/app');
const { demoConfig } = require('./src/demo');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const demo = demoConfig();

const app = createApp({ dataDir: DATA_DIR, setupCode: process.env.SETUP_CODE || '', demo });

const server = app.listen(PORT, HOST, () => {
  console.log(`📅 Mawid is running on http://localhost:${PORT}`);
  console.log(`   Data directory: ${DATA_DIR}`);
  if (demo) console.log(`   DEMO MODE: password "${demo.password}", resets every ${demo.resetMinutes} min`);
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    app.locals.store.flushStats();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
