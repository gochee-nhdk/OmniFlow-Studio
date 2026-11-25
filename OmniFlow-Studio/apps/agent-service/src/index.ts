import path from 'path';
import fs from 'fs';
import { FMDatabase } from '@fm/database';
import { BrowserManager } from '@fm/browser-engine';
import { AgentServiceServer, fastTcpProbe } from './server';
import { DEFAULT_AGENT_SERVICE_PORT, DEFAULT_AGENT_SERVICE_HOST } from '@fm/shared-types';

export { AgentServiceServer, fastTcpProbe };

function detectDataDir(): string {
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    return path.join(path.resolve(process.env.PORTABLE_EXECUTABLE_DIR), 'data');
  }
  if (process.env.OMNIFLOW_PORTABLE_DATA) {
    return path.resolve(process.env.OMNIFLOW_PORTABLE_DATA);
  }
  if (process.env.APP_DATA_DIR) {
    return path.resolve(process.env.APP_DATA_DIR);
  }
  if (process.env.PORTABLE_DATA_DIR) {
    return path.resolve(process.env.PORTABLE_DATA_DIR);
  }
  return path.join(process.cwd(), 'data');
}

export async function runStandaloneDaemon(cliArgs: string[] = process.argv.slice(2)): Promise<AgentServiceServer> {
  let port = DEFAULT_AGENT_SERVICE_PORT;
  let host = DEFAULT_AGENT_SERVICE_HOST;
  let headless = true;
  let customDataDir: string | null = null;

  for (let i = 0; i < cliArgs.length; i++) {
    const arg = cliArgs[i];
    if (arg === '--port' || arg === '-p') {
      port = parseInt(cliArgs[++i], 10) || DEFAULT_AGENT_SERVICE_PORT;
    } else if (arg === '--host' || arg === '-h') {
      host = cliArgs[++i] || DEFAULT_AGENT_SERVICE_HOST;
    } else if (arg === '--data' || arg === '-d') {
      customDataDir = cliArgs[++i];
    } else if (arg === '--headless') {
      headless = true;
    } else if (arg === '--no-headless' || arg === '--headed') {
      headless = false;
    }
  }

  if (process.env.PORT) {
    port = parseInt(process.env.PORT, 10) || port;
  }
  if (process.env.HOST) {
    host = process.env.HOST;
  }

  const dataDir = customDataDir ? path.resolve(customDataDir) : detectDataDir();
  const dbPath = path.join(dataDir, 'fmauto.sqlite');
  const tempDownloadDir = path.join(dataDir, 'Temp');
  const reportsDir = path.join(dataDir, 'reports');
  const logsDir = path.join(dataDir, 'logs');

  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(tempDownloadDir, { recursive: true });
    fs.mkdirSync(reportsDir, { recursive: true });
    fs.mkdirSync(logsDir, { recursive: true });
  } catch {}

  const db = new FMDatabase(dbPath);
  try {
    const initSnapshot = db.createBackup();
    console.log(`[Database] Initial backup snapshot created: ${initSnapshot.backupPath}`);
  } catch {}

  const browserManager = new BrowserManager({
    downloadDir: tempDownloadDir,
    userDataDir: dataDir,
    headless,
    allowCdpAttach: false,
    cdpPorts: [9222, 9223, 9229],
  });

  const server = new AgentServiceServer({
    port,
    host,
    db,
    browserManager,
    onBroadcast: (channel, data) => {
      // Standalone log for diagnostic awareness
      if (process.env.DEBUG === 'true' || channel === 'workflow:status') {
        console.log(`[Broadcast] [${channel}]`, JSON.stringify(data));
      }
    },
  });

  await server.start();

  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║         OmniFlow Studio — Standalone Agent Service             ║');
  console.log('║               Backend HTTP & WebSocket Server                  ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log(` Mode:       Standalone Headless Daemon (Headless: ${headless})`);
  console.log(` HTTP:       http://${host}:${port}`);
  console.log(` WebSocket:  ws://${host}:${port}/ws`);
  console.log(` Health:     http://${host}:${port}/health`);
  console.log(` Data Dir:   ${dataDir}`);
  console.log(` Database:   ${dbPath}`);
  console.log(' Ready for Browser Extension & Automation Clients.');

  const shutdown = async () => {
    console.log('\n[OmniFlow Agent Service] Shutting down...');
    try {
      await server.stop();
      await browserManager.shutdown();
    } catch {}
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return server;
}

if (require.main === module) {
  runStandaloneDaemon().catch((err) => {
    console.error('FATAL in OmniFlow Agent Service:', err);
    process.exit(1);
  });
}
