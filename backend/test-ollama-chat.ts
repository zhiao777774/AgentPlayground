import { AuthStorage, createAgentSession, ModelRegistry, SessionManager } from '@mariozechner/pi-coding-agent';
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

    session.subscribe((event) => {
        console.log("EVENT TYPE:", event.type);
        if (event.type === 'message_update') {
            const amEvent = (event as any).assistantMessageEvent;
            console.log("  ->", amEvent.type, amEvent.textDelta || "");
        } else if (event.type === 'tool_execution_start') {
            console.log("  -> TOOL:", (event as any).toolName);
        }
    });

    console.log("Sending MSG...");
    await session.sendUserMessage("Count from 1 to 5.");
    console.log("sendUserMessage ended");
}

run().catch(console.error);
