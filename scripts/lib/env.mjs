// .env.local を読み込む最小ローダー（依存パッケージなし）。コマンドから使う。
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ENV_FILE_PATH = resolve(ROOT, '.env.local');

let loaded = false;

/** .env.local を process.env に流し込む（既存の環境変数は上書きしない）。 */
export function loadEnv() {
  if (loaded) return;
  loaded = true;

  if (!existsSync(ENV_FILE_PATH)) {
    throw new Error(`.env.local が見つかりません: ${ENV_FILE_PATH}\n  npm run env:init -- --sa <サービスアカウントJSON> で作れます。`);
  }

  const raw = readFileSync(ENV_FILE_PATH, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
