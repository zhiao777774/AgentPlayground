import { AuthStorage, createAgentSession, ModelRegistry, SessionManager } from '@mariozechner/pi-coding-agent';
import { streamSimple } from '@mariozechner/pi-ai';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function run() {
    const authStorage = AuthStorage.create();
    const modelRegistry = new ModelRegistry(authStorage, path.resolve(__dirname, 'models.json'));
    const sessionManager = SessionManager.inMemory();
    
    const allModels = modelRegistry.getAll();
    const model = allModels.find(m => m.id === 'qwen3:8b');
    
    console.log("Found model:", model?.id);

    const { session } = await createAgentSession({
        cwd: process.cwd(),
        agentDir: path.resolve(__dirname, '../'),
        authStorage,
        modelRegistry,
        sessionManager,
        model
    });

    try {
        const stream = await streamSimple(model!, {
            systemPrompt: "You are a helpful assistant.",
            messages: [{ role: 'user', content: 'What is 3+3?' }]
        }, {});
        
        for await (const chunk of stream) {
            if (chunk.type === 'text') console.log("TEXT:", chunk.textDelta);
            if (chunk.type === 'thinking') console.log("THINKING:", chunk.thinkingDelta);
        }
    } catch(e) {
        console.error("streamSimple Error:", e);
    }
}

run().catch(console.error);
