import { EnvError, envNames, loadEnv, loadLocalEnvFile, secretNames } from "../src/index";

const file = loadLocalEnvFile();
console.log(file ? `Read ${file}` : "No .env.local found at the workspace root");

try {
  const env = loadEnv();
  for (const name of envNames) {
    const value = env[name];
    const shown = secretNames.has(name) ? (value === undefined ? "not set" : "set") : String(value);
    console.log(`${name.padEnd(22)} ${shown}`);
  }
} catch (error) {
  if (!(error instanceof EnvError)) throw error;
  console.error(error.message);
  process.exitCode = 1;
}
