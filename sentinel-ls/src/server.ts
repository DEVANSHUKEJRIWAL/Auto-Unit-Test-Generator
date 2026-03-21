import {
    createConnection,
    TextDocuments,
    ProposedFeatures,
    InitializeParams,
    TextDocumentSyncKind,
    InitializeResult,
    WorkspaceEdit,
    Range
} from 'vscode-languageserver/node';
import { CreateFile } from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';
import {testGenGraph, codeHealerGraph} from './agent';
import * as fs from 'fs';
import {Diagnostic, DiagnosticSeverity} from "vscode-languageserver";
import { CodeAction, CodeActionKind, Command } from 'vscode-languageserver/node';
import { exec } from "child_process";
import { promisify } from "util";
import * as path from "path";

// 1. Establish connection with the IDE (IntelliJ)
const connection = createConnection(ProposedFeatures.all);
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);
const execAsync = promisify(exec);

connection.onInitialize((params: InitializeParams) => {
    return {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Full,
            // 1. Enable Code Actions
            codeActionProvider: true,
            // 2. Register a command to be executed
            executeCommandProvider: {
                commands: ['sentinel.generateTestForLine',// (If you have this one here)
                    'sentinel.healCodeCommand']
            }
        }
    };
});

connection.onCodeAction((params) => {
    const textDocument = documents.get(params.textDocument.uri);
    if (!textDocument) return [];

    // Button 1: The original Test Generator
    const testAction = CodeAction.create(
        '✨ Sentinel: Generate Unit Test for this method',
        Command.create('Generate Test', 'sentinel.promptRequirements', params.textDocument.uri, params.range),
        CodeActionKind.QuickFix               
    );

    // Button 2: The NEW Code Healer
    const healAction = CodeAction.create(
        '🏥 Sentinel: Auto-Fix Code to Pass Tests',
        Command.create('Heal Code', 'sentinel.healCodeCommand', params.textDocument.uri, params.range),
        CodeActionKind.QuickFix
    );

    return [testAction, healAction];
});

connection.onExecuteCommand(async (params) => {
    
    // ==========================================
    // AGENT 1: THE TEST GENERATOR
    // ==========================================
    if (params.command === 'sentinel.generateTestForLine') {
        const uri = params.arguments?.[0];
        const range = params.arguments?.[1];
        const requirements = params.arguments?.[2] || ""; 
        const document = documents.get(uri);
        if (!document) return;

        connection.window.showInformationMessage("🧠 Sentinel is generating tests...");

        // 1. Trigger the Generator Agent
        const result = await testGenGraph.invoke({
            code: document.getText(),
            testCode: "",
            errors: [],
            iterations: 0,
            filePath: uri,
            requirements: requirements
        });

        // 2. Automatically create the file and paste the test code
        const testUri = uri.replace(/\.(ts|js)$/, '.test.$1');
        const workspaceEdit: WorkspaceEdit = {
            documentChanges: [
                CreateFile.create(testUri, { overwrite: true, ignoreIfExists: true }),
                {
                    textDocument: { uri: testUri, version: null },
                    edits: [
                        { range: Range.create(0, 0, 0, 0), newText: result.testCode }
                    ]
                }
            ]
        };
        await connection.workspace.applyEdit(workspaceEdit);
        connection.window.showInformationMessage("✅ Sentinel successfully generated tests!");
    }

    // ==========================================
    // AGENT 2: THE CODE HEALER
    // ==========================================
    if (params.command === 'sentinel.healCodeCommand') {
        const uri = params.arguments?.[0];
        const document = documents.get(uri);
        if (!document) return;

        const sourcePath = uri.replace('file://', '');
        const testFileExt = sourcePath.endsWith('.ts') ? '.test.ts' : '.test.js';
        const testPath = sourcePath.replace(/\.(ts|js)$/, testFileExt);

        let testCode = "";
        try {
            testCode = fs.readFileSync(testPath, 'utf8');
        } catch (e) {
            connection.window.showErrorMessage("Sentinel: Could not find a matching test file! Please generate tests first.");
            return;
        }

        connection.window.showInformationMessage("🏥 Sentinel is diagnosing and healing your code...");

        const result = await codeHealerGraph.invoke({
            sourceCode: document.getText(),
            testCode: testCode,
            errors: [],
            iterations: 0,
            sourceFilePath: uri
        });

        const edit = {
            changes: {
                [uri]: [{
                    range: {
                        start: { line: 0, character: 0 },
                        end: { line: document.lineCount, character: 0 }
                    },
                    newText: result.sourceCode
                }]
            }
        };
        connection.workspace.applyEdit(edit);
        connection.window.showInformationMessage("✅ Sentinel successfully healed the code!");
    }
});

// 2. TRIGGER: This runs every time you save a file in IntelliJ
documents.onDidSave(async (change) => {
    const document = change.document;
    const uri = document.uri;

    // UPGRADED: A much stronger shield to ignore all variations of test files
    if (
        uri.includes('.test.') || 
        uri.includes('.spec.') || 
        uri.endsWith('test.ts') || 
        uri.endsWith('test.js')
    ) {
        return;
    }

    const sourcePath = uri.replace('file://', '');
    const testFileExt = sourcePath.endsWith('.ts') ? '.test.ts' : '.test.js';
    const testPath = sourcePath.replace(/\.(ts|js)$/, testFileExt);

    if (!fs.existsSync(testPath)) {
        return; 
    }

    connection.console.log(`\n👀 [Sentinel Watcher] File saved. Running regression tests for ${sourcePath}...`);

    try {
        const workspaceDir = path.dirname(sourcePath);

        // Tell Vitest to run specifically inside that folder
        await execAsync(`npx vitest run "${testPath}" --coverage`, { cwd: workspaceDir });

        // SUCCESS! Use the unmodified document.uri to clear the squiggly
        connection.sendDiagnostics({ 
            uri: document.uri, 
            diagnostics: [] 
        });
        connection.console.log(`✅ [Sentinel Watcher] All tests passed. Diagnostics cleared.`);
        
    } catch (error: any) {
        // Let's print the actual error to the Output panel so we know WHY it failed
        connection.console.log(`❌ [Sentinel Watcher] Test run failed! Reason:`);
        connection.console.log(error.stdout || error.message);
        
        const diagnostic: Diagnostic = {
            severity: DiagnosticSeverity.Error,
            range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 100 } 
            },
            message: '🚨 Sentinel: You broke a unit test! Click the lightbulb (Cmd + .) to Auto-Fix.',
            source: 'Sentinel'
        };

        // Use the unmodified document.uri to apply the squiggly
        connection.sendDiagnostics({ 
            uri: document.uri, 
            diagnostics: [diagnostic] 
        });

        connection.window.showErrorMessage("🚨 Sentinel: Regression detected!");
    }
});

async function refreshDiagnostics(document: TextDocument): Promise<void> {
    const code = document.getText();
    const diagnostics: Diagnostic[] = [];

    // Logic: If a method exists but has no mention in the .test file
    // We'll mark it with a 'Warning'
    diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range: {
            start: { line: 5, character: 0 }, // Example: Line 5 has no test
            end: { line: 5, character: 20 }
        },
        message: 'Sentinel: This method has no unit tests.',
        source: 'AutoTest Sentinel'
    });

    connection.sendDiagnostics({ uri: document.uri, diagnostics });
}

async function applyTestEdit(uri: string, testCode: string) {
    const testUri = uri.replace(/\.(ts|js|java)$/, '.test.$1');

    const workspaceEdit: WorkspaceEdit = {
        documentChanges: [
            // 1. Explicitly tell VS Code to create the file first
            CreateFile.create(testUri, { overwrite: true, ignoreIfExists: true }),
            // 2. Then insert the code into that new file
            {
                textDocument: { uri: testUri, version: null },
                edits: [
                    {
                        range: Range.create(0, 0, 0, 0),
                        newText: testCode
                    }
                ]
            }
        ]
    };

    const result = await connection.workspace.applyEdit(workspaceEdit);

    if (result.applied) {
        connection.window.showInformationMessage('✨ Sentinel: Test file created!');
    } else {
        connection.window.showErrorMessage('❌ Sentinel: Failed to write test file.');
    }
}

async function updateHeatmap(document: TextDocument) {
    const diagnostics: Diagnostic[] = [];
    const text = document.getText();

    // For the MVP: Let's mark every method that doesn't have a matching
    // test file yet as 'Uncovered'
    const methodRegex = /public\s+\w+\s+(\w+)\s*\(/g;
    let match;

    while ((match = methodRegex.exec(text)) !== null) {
        diagnostics.push({
            severity: DiagnosticSeverity.Information,
            range: Range.create(document.positionAt(match.index), document.positionAt(match.index + match[0].length)),
            message: '🛡️ Sentinel: This method is not yet covered by a unit test.',
            source: 'AutoTest Sentinel'
        });
    }

    connection.sendDiagnostics({ uri: document.uri, diagnostics });
}
// Make the text document manager listen on the connection
documents.listen(connection);
connection.listen();