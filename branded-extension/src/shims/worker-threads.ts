export const isMainThread = true;
export const workerData: Record<string, never> = {};
export const parentPort = null;

export class Worker {
  constructor() {
    throw new Error('worker_threads is not available in this environment.');
  }
}

const workerThreads = { isMainThread, workerData, parentPort, Worker };

export default workerThreads;
