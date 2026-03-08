import { ModelRegistry } from '@mariozechner/pi-coding-agent';

const registry = new ModelRegistry();
const all = registry.getAll();
const ollama = all.filter(m => m.id.includes('qwen'));
console.log(ollama);
