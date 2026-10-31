import fs from 'node:fs';
import path from 'node:path';
import config from './hq/config.js';
import { Store } from './hq/store.js';
import { Runner } from './hq/runner.js';
import { createApp } from './hq/http.js';
import { Desk } from './hq/desk.js';
import { Grove } from './hq/grove.js';

fs.mkdirSync(config.dataDir, { recursive: true });
const store = new Store(path.join(config.dataDir, 'hq.sqlite'));
const runner = new Runner({ store, config });
const desk = config.desk ? new Desk({ path: path.join(config.dataDir, 'desk.sqlite'), config: config.desk }) : null;
const grove = config.grove ? new Grove({
  path: path.join(config.dataDir, 'grove.sqlite'),
  config: { ...config.grove, workDir: path.join(config.workDir, 'grove') },
}) : null;
const server = createApp({ store, runner, desk, grove, config, publicDir: path.join(config.root, 'public') });

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Agent HQ: port ${config.port} is already in use. Is Agent HQ already running? Set PORT to use another port.`);
  } else {
    console.error('Agent HQ could not start:', err.message);
  }
  process.exit(1);
});

server.listen(config.port, '127.0.0.1', () => {
  console.log(`Agent HQ on http://127.0.0.1:${server.address().port}`);
  // Only the instance that owns the port may requeue tickets left "working".
  store.resetWorking();
  runner.kick();
  desk?.start();
  grove?.start();
});
