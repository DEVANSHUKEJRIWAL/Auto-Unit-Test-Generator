
import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import { Annotation, StateGraph, END, START } from "@langchain/langgraph";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOllama } from "@langchain/ollama";
import { Project } from "ts-morph";

const useLocalModel = process.env.USE_LOCAL === 'true';
const execAsync = promisify(exec);

const model = useLocalModel ? new ChatOllama({
    model: "deepseek-coder:6.7b",
    baseUrl: "http://localhost:11434"
})
: new ChatGoogleGenerativeAI({
    model: "gemini-2.5-flash", // <-- Changed from modelName to model
    temperature: 0,
    apiKey: process.env.GEMINI_API_KEY 
});

// 1. Define the State (The "Memory" of our Agent)
const AgentState = Annotation.Root({
    code: Annotation<string>(),      
    testCode: Annotation<string>(),  
    errors: Annotation<string[]>({
        reducer: (x, y) => y // This ensures we only look at the most recent error
    }),  
    iterations: Annotation<number>(), 
    targetLine: Annotation<number>(),
    filePath: Annotation<string>(), // NEW: The path to the file being tested
});



function getDependencyContext(filePath: string, sourceCode: string) {
    const project = new Project();
    const sourceFile = project.createSourceFile("temp.ts", sourceCode, { overwrite: true });

    // Find all imported interfaces/classes
    const imports = sourceFile.getImportDeclarations();
    let context = "MOCKING CONTEXT (Use these actual methods):\n";

    imports.forEach(imp => {
        const moduleName = imp.getModuleSpecifierValue();
        // Only scan local files, skip node_modules for now
        if (moduleName.startsWith('.')) {
            context += `- Dependency ${moduleName} has methods: [Extracted from AST]\n`;
        }
    });

    return context;
}
// 2. Node: Generate the initial test
async function generateTest(state: typeof AgentState.State) {
    console.log(`✍️ [Sentinel] Gemini is generating code (Iteration ${state.iterations || 0})...`);
    const context = getDependencyContext("current.ts", state.code);

    // 1. Check if we are in the "Healing" phase
    const isHealing = state.errors && state.errors.length > 0;
    const errorContext = isHealing ? `
    WARNING! Your previous attempt failed with this error:
    ${state.errors[0]}
    
    PREVIOUS TEST CODE:
    ${state.testCode}
    
    Please fix the test code so it passes the Vitest execution.
    ` : "";

    const prompt = `
    TASK: Generate a Vitest/JUnit unit test.
    ${context}
    
    SOURCE CODE TO TEST:
    ${state.code}

    ${errorContext}

    STRICT RULES:
    1. Do NOT hallucinate methods. Use the provided MOCKING CONTEXT.
    2. Use Mockito (if Java) or Vi.mock (if TS).
    3. Return ONLY raw code. Do not wrap it in markdown blockticks (like \`\`\`typescript).
  `;

    const response = await model.invoke(prompt);
    
    
    // Clean up potential markdown formatting from the AI
    let cleanCode = response.content as string;
    const codeBlockMatch = cleanCode.match(/
    http://googleusercontent.com/immersive_entry_chip/0

    return {
        testCode: cleanCode,
        iterations: (state.iterations || 0) + 1
    };
}

async function validateTest(state: typeof AgentState.State) {
    const errors: string[] = [];

    // Basic Static Analysis: Check if the AI forgot to import the class it's testing
    const classNameMatch = state.code.match(/(?:class|interface)\s+(\w+)/);
    if (classNameMatch && !state.testCode.includes(classNameMatch[1])) {
        errors.push(`The test is missing the class name: ${classNameMatch[1]}`);
    }

    // Check for common AI hallucinations
    if (state.testCode.includes("TODO") || state.testCode.length < 50) {
        errors.push("The generated test is incomplete or contains placeholders.");
    }

    return { errors };
}

async function executeTestNode(state: typeof AgentState.State) {
    console.log(`\n🧠 [Sentinel] Executing test attempt #${state.iterations}...`);
    
    const originalPath = state.filePath.replace('file://', '');
    const tempTestPath = originalPath.replace(/\.(ts|js)$/, '.temp.test.$1');

    fs.writeFileSync(tempTestPath, state.testCode);

    try {
        // Force verbose text output so Gemini can read the actual stack trace
        const { stdout, stderr } = await execAsync(`npx vitest run ${tempTestPath} --reporter=verbose`);
        
        console.log(`✅ [Sentinel] Test passed successfully!`);
        fs.unlinkSync(tempTestPath); 
        return { errors: [] };       
    } catch (error: any) {
        fs.unlinkSync(tempTestPath); 
        
        // Grab the detailed output (Vitest puts failure details in stdout even on crash)
        const terminalOutput = error.stdout || error.stderr || error.message;
        
        console.log(`❌ [Sentinel] Test failed. Sending this error back to Gemini to fix:`);
        console.log(terminalOutput.substring(0, 200) + "..."); // Just log the first part so we don't spam the console
        
        return { errors: [terminalOutput] };
    }
}

// 4. Logic: Decide whether to finish or fix
// 4. Logic: Decide whether to finish or loop back
function shouldContinue(state: typeof AgentState.State) {
    if (state.errors.length === 0) return END; // Success! Exit the graph.
    if (state.iterations >= 3) return END;     // Give up after 3 tries to prevent infinite loops.
    return "fix";                              // Errors found! Loop back to Generate.
}

// 5. Build the Autonomous Loop
export const testGenGraph = new StateGraph(AgentState)
    .addNode("generate", generateTest)
    .addNode("validate", validateTest)
    .addNode("execute", executeTestNode) // Add the new Executor
    .addEdge(START, "generate")
    .addEdge("generate", "validate")
    .addEdge("validate", "execute")      // Validate hands off to Execute
    .addConditionalEdges("execute", shouldContinue, {
        fix: "generate",                 // If failed, loop back to start
        [END]: END,                      // If passed, finish
    })
    .compile();