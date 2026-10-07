import { parentPort, workerData } from "node:worker_threads";
import ELK from "elkjs/lib/elk.bundled.js";

if (!parentPort) throw new Error("This layout entry is only available as an on-demand worker.");
const port = parentPort;
void new ELK().layout(workerData).then(
  result => port.postMessage({ result }),
  error => port.postMessage({ error: error instanceof Error ? error.message : String(error) }),
);
