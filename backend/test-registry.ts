import { ModelRegistry, AuthStorage } from '@mariozechner/pi-coding-agent';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const authStorage = AuthStorage.create();
const registry = new ModelRegistry(authStorage, path.resolve(__dirname, '../models.json'));

const error = registry.getError();
console.log("Error:", error);
const models = registry.getAll();
const filtered = models.filter(m => m.id === 'ollama/qwen3:8b');
console.log("Filtered count:", filtered.length);
console.log("Filtered:", JSON.stringify(filtered, null, 2));
