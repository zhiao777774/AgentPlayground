import { ModelRegistry, AuthStorage } from '@mariozechner/pi-coding-agent';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const authStorage = AuthStorage.create();
const registry = new ModelRegistry(
    authStorage,
    path.resolve(__dirname, './models.json'),
);

console.log('Error:', registry.getError());
const qwen = registry.getAll().find((m: any) => m.id === 'qwen3:8b');
console.log('Qwen3 loaded:', qwen);
