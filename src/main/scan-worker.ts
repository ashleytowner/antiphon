import { parentPort, workerData } from 'node:worker_threads';
import { Library } from './library';
const library = new Library(workerData.database);
library.scan(workerData.root, progress => parentPort!.postMessage(progress))
  .catch(error => parentPort!.postMessage({ phase: 'error', count: 0, message: String(error.message ?? error) }))
  .finally(() => library.close());
