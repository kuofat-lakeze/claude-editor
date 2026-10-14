import "dotenv/config";

function required(name: string, fallbackForTest?: string): string {
  const v = process.env[name];
  if (v && v.length > 0) return v;
  if (process.env.NODE_ENV === "test" && fallbackForTest !== undefined) return fallbackForTest;
  throw new Error(`缺少環境變數 ${name}，請參考 .env.example 設定`);
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  publicUrl: (process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 3000}`).replace(/\/+$/, ""),
  adminPassword: required("ADMIN_PASSWORD", "test-password"),
  sessionSecret: required("SESSION_SECRET", "test-secret"),
  metaVerifyToken: required("META_VERIFY_TOKEN", "test-verify"),
  metaAppSecret: process.env.META_APP_SECRET ?? "",
  graphVersion: process.env.META_GRAPH_VERSION ?? "v21.0",
  databasePath: process.env.DATABASE_PATH ?? "./data/app.db",
};
