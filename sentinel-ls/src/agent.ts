import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import { Annotation, StateGraph, END, START } from "@langchain/langgraph";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOllama } from "@langchain/ollama";
import { Project } from "ts-morph";
import * as path from "path";

const useLocalModel = process.env.USE_LOCAL === 'true';
const execAsync = promisify(exec);

const model = useLocalModel ? new ChatOllama({
    model: "deepseek-coder:6.7b",
    baseUrl: "http://localhost:11434"
})
    : new ChatGoogleGenerativeAI({
        model: "gemini-2.5-flash",
        temperature: 0,
        apiKey: process.env.GEMINI_API_KEY
    });

// ==========================================
// 🧪 AGENT 1: THE TEST GENERATOR
// ==========================================

const AgentState = Annotation.Root({
    code: Annotation<string>(),
    testCode: Annotation<string>(),
    errors: Annotation<string[]>({
        reducer: (x, y) => y
    }),
    iterations: Annotation<number>(),
    targetLine: Annotation<number>(),
    filePath: Annotation<string>(),
    requirements: Annotation<string>(),
});

function getDependencyContext(filePath: string, sourceCode: string) {
    const project = new Project();
    const sourceFile = project.createSourceFile("temp.ts", sourceCode, { overwrite: true });
    const imports = sourceFile.getImportDeclarations();
    
    let context = "MOCKING CONTEXT (Do not hallucinate methods. Use ONLY these extracted signatures for your vi.mock() statements):\n";

    // Get the directory of the current file to resolve relative paths like './database'
    const currentDir = path.dirname(filePath.replace('file://', ''));

    imports.forEach(imp => {
        const moduleName = imp.getModuleSpecifierValue();
        
        // Only scan local project files (ignore node_modules like 'react' or 'vitest')
        if (moduleName.startsWith('.')) {
            let depPath = path.join(currentDir, moduleName);
            
            // Handle TypeScript/JavaScript extensions if they were omitted in the import
            if (!depPath.endsWith('.ts') && !depPath.endsWith('.js')) {
                if (fs.existsSync(depPath + '.ts')) depPath += '.ts';
                else if (fs.existsSync(depPath + '.js')) depPath += '.js';
            }

            if (fs.existsSync(depPath)) {
                context += `\n📦 Dependency: '${moduleName}'\n`;
                
                // Read the actual external file!
                const depFile = project.addSourceFileAtPath(depPath);
                
                // Extract standalone exported functions
                depFile.getFunctions().forEach(func => {
                    if (func.isExported()) {
                        context += `- Function: ${func.getName()}(${func.getParameters().map(p => p.getText()).join(', ')})\n`;
                    }
                });

                // Extract exported classes and their methods
                depFile.getClasses().forEach(cls => {
                    if (cls.isExported()) {
                        context += `- Class: ${cls.getName()}\n`;
                        cls.getMethods().forEach(method => {
                            context += `   * Method: ${method.getName()}(${method.getParameters().map(p => p.getText()).join(', ')})\n`;
                        });
                    }
                });
            } else {
                context += `📦 Dependency '${moduleName}': [File not found for AST parsing]\n`;
            }
        }
    });

    return context;
}

async function generateTest(state: typeof AgentState.State) {
    console.log(`✍️ [Sentinel] Gemini is generating code (Iteration ${state.iterations || 0})...`);
    const context = getDependencyContext(state.filePath, state.code);

    const isHealing = state.errors && state.errors.length > 0;
    const errorContext = isHealing ? `
    WARNING! Your previous attempt failed with this error:
    ${state.errors[0]}
    
    PREVIOUS TEST CODE:
    ${state.testCode}
    
    Please fix the test code so it passes the Vitest execution.
    ` : "";

    const humanIntent = state.requirements ? `
    CRITICAL HUMAN REQUIREMENTS:
    The user explicitly stated this code must do the following: "${state.requirements}"
    If the source code behaves differently than this requirement, write the test based on the REQUIREMENT, not the broken source code!
    ` : "";

    const prompt = `
    TASK: Generate a Vitest/JUnit unit test.
    ${context}
    
    SOURCE CODE TO TEST:
    ${state.code}

    ${errorContext}
    ${humanIntent}

    STRICT QA ENGINEERING RULES:
    1. YOU MUST IMPORT THE FUNCTION. Never remove the import statement. Assume the test is running in a separate '.test.ts' file next to the source code.
    2. OBEY THE HUMAN INTENT. If "CRITICAL HUMAN REQUIREMENTS" are provided, they are the absolute truth. If the SOURCE CODE behaves differently than the HUMAN REQUIREMENT, write the test to enforce the requirement (the test should fail). Do not write tests that validate broken source code.
    3. Do NOT hallucinate methods. Use the provided MOCKING CONTEXT.
    4. Return ONLY raw executable code.
    5. CRITICAL VITEST MOCKING: To mock classes and change return values dynamically inside tests, you MUST use the 'vi.hoisted()' pattern. Do not define plain variables outside vi.mock().
       Example Pattern:
       const mocks = vi.hoisted(() => ({
         fetchUserDiscount: vi.fn(),
         connect: vi.fn()
       }));

       vi.mock('./database', () => {
         return {
           Database: vi.fn().mockImplementation(() => mocks)
         };
       });

       // Inside your describe block / tests:
       mocks.fetchUserDiscount.mockReturnValue(15);
  `;

    const response = await model.invoke(prompt);

    let cleanCode = response.content as string;
    const codeBlockMatch = cleanCode.match(/```(?:ts|typescript|javascript)?\n([\s\S]*?)```/);

    if (codeBlockMatch) {
        cleanCode = codeBlockMatch[1].trim();
    }

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

export const HealerState = Annotation.Root({
    sourceCode: Annotation<string>(),
    testCode: Annotation<string>(),
    sourceFilePath: Annotation<string>(),
    errors: Annotation<string[]>({ reducer: (x, y) => y }),
    iterations: Annotation<number>(),
});

async function generateFixedCode(state: typeof HealerState.State) {
    console.log(`\n🏥 [Sentinel Healer] Diagnosing and fixing source code (Iteration ${state.iterations || 0})...`);

    const prompt = `
    TASK: You are an expert Senior Developer. The unit tests are FAILING. 
    The tests are CORRECT (they represent the business requirements). The SOURCE CODE is BROKEN.
    Fix the SOURCE CODE to make the tests pass.

    FAILING TEST LOGS:
    ${state.errors?.[0] || "Initial run. Read the tests and fix the code to match them."}

    STRICT UNIT TESTS (YOUR GOAL):
    ${state.testCode}

    CURRENT BROKEN SOURCE CODE:
    ${state.sourceCode}

    STRICT RULES:
    1. Return the ENTIRE fixed source code file. Do not omit imports.
    2. Do not include markdown formatting like \`\`\`typescript.
    3. ONLY return executable code.
    `;

    const response = await model.invoke(prompt);

    let cleanCode = response.content as string;

    // Robust cleanup
    cleanCode = cleanCode
        .replace(/^[\s\S]*?```/, "")
        .replace(/```[\s\S]*$/, "")
        .trim();

    // Fallback safety
    if (!cleanCode || cleanCode.length < 10) {
        return {
            ...state,
            errors: ["LLM returned empty or invalid code"],
            iterations: (state.iterations || 0) + 1,
        };
    }

    return {
        ...state,
        sourceCode: cleanCode,
        errors: [],
        iterations: (state.iterations || 0) + 1,
    };
}

async function executeHealedTest(state: typeof HealerState.State) {
    console.log(`\n🧪 [Sentinel Healer] Running tests against healed code...`);
    
    const sourcePath = state.sourceFilePath.replace('file://', '');
    fs.writeFileSync(sourcePath, state.sourceCode);

    const testFileExt = sourcePath.endsWith('.ts') ? '.test.ts' : '.test.js';
    const testPath = sourcePath.replace(/\.(ts|js)$/, testFileExt);

    try {
        await execAsync(`npx vitest run "${testPath}" --reporter=verbose`);
        console.log(`✅ [Sentinel Healer] Tests passed! Code is fully healed.`);
        return { errors: [] };
    } catch (error: any) {
        let terminalOutput = error.stdout || error.stderr || error.message;
        terminalOutput = terminalOutput.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
        console.log(`❌ [Sentinel Healer] Tests still failing. Looping back to Gemini...`);
        return { errors: [terminalOutput] };
    }
}

function shouldContinueHealing(state: typeof HealerState.State) {
    if (state.errors.length === 0 || state.iterations >= 3) return END;     
    return "fix";                              
}

export const codeHealerGraph = new StateGraph(HealerState)
    .addNode("generateFix", generateFixedCode)
    .addNode("execute", executeHealedTest)
    .addEdge(START, "generateFix")
    .addEdge("generateFix", "execute")
    .addConditionalEdges("execute", shouldContinueHealing, {
        fix: "generateFix",
        [END]: END,
    })
    .compile();