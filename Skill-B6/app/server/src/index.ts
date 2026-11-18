import { HOST, PORT } from './config.js';
import { buildApp } from './app.js';

async function main() {
  const { app } = await buildApp();
  await app.listen({ host: HOST, port: PORT });
  console.log(`B6 Local Studio server listening at http://${HOST}:${PORT}`);
}

main().catch((err) => {
  console.error('Failed to start B6 Local Studio server:', err);
  process.exit(1);
});
