import { createApp } from './app.js';
import { readConfig } from './config/index.js';
import { configuredBlobStore } from './storage/configured-blobs.js';

const config = readConfig();
const { app } = await createApp({
  databasePath: config.DATABASE_PATH,
  logger: true,
  blobStore: configuredBlobStore(config),
  attachmentQuotaBytes: config.ATTACHMENT_QUOTA_BYTES,
  trustProxy: config.TRUST_PROXY.split(',')
    .map((value) => value.trim())
    .filter(Boolean),
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close();
  });
}
await app.listen({ host: config.HOST, port: config.PORT });
