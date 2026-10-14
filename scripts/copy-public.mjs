// 把 src/public 的靜態檔複製到 dist/public（tsc 不會處理非 ts 檔）
import { cpSync, mkdirSync } from "node:fs";
mkdirSync("dist/public", { recursive: true });
cpSync("src/public", "dist/public", { recursive: true });
console.log("copied src/public -> dist/public");
