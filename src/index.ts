import { config } from "./config.js";
import { openDb } from "./db.js";
import { createGraphSender } from "./meta/sendApi.js";
import { createApp } from "./app.js";

const db = openDb(config.databasePath);
const app = createApp({
  db,
  sender: createGraphSender(config.graphVersion),
  publicUrl: config.publicUrl,
  graphVersion: config.graphVersion,
  verifyToken: config.metaVerifyToken,
  appSecret: config.metaAppSecret,
  adminPassword: config.adminPassword,
  sessionSecret: config.sessionSecret,
});

app.listen(config.port, () => {
  console.log(`✅ 伺服器啟動：http://localhost:${config.port}`);
  console.log(`   後台：${config.publicUrl}/`);
  console.log(`   Meta Webhook 回呼網址：${config.publicUrl}/webhook`);
  if (!config.metaAppSecret) console.warn("⚠️  未設定 META_APP_SECRET，Webhook 簽章不會被驗證（正式環境請務必設定）");
});
