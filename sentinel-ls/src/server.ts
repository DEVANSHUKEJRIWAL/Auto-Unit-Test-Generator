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
// @ts-ignore
import {testGenGraph} from './agent';
import {Diagnostic, DiagnosticSeverity} from "vscode-languageserver";
import { CodeAction, CodeActionKind, Command } from 'vscode-languageserver/node';

// 1. Establish connection with the IDE (IntelliJ)
const connection = createConnection(ProposedFeatures.all);
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

connection.onInitialize((params: InitializeParams) => {
    return {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Full,
            // 1. Enable Code Actions
            codeActionProvider: true,
            // 2. Register a command to be executed
            executeCommandProvider: {
                commands: ['sentinel.generateTestForLine']
            }
        }
    };
});

connection.onCodeAction((params) => {
    const textDocument = documents.get(params.textDocument.uri);
    if (!textDocument) return [];

    const action = CodeAction.create(
        '✨ Sentinel: Generate Unit Test for this method',
        Command.create(
            'Generate Test',                  
            'sentinel.generateTestForLine',   
            params.textDocument.uri,          
            params.range                      
        ),
        // THIS IS THE CRITICAL CHANGE
        CodeActionKind.QuickFix               
    );

    return [action];
});

connection.onExecuteCommand(async (params) => {
    if (params.command === 'sentinel.generateTestForLine' && params.arguments) {
        // Safely extract the arguments we passed in the CodeAction above
        const uri = params.arguments[0] as string;
        const range = params.arguments[1] as Range;
        
        const document = documents.get(uri);
        if (!document) return;

        connection.window.showInformationMessage('🧠 Sentinel is thinking...');

        try {
            // Get just the text the user highlighted
            const selectedText = document.getText(range);
            
            // Invoke your LangGraph agent
            const result = await testGenGraph.invoke({
                code: selectedText || document.getText(), // Fallback to whole file if no selection
                testCode: "",
                errors: [],
                iterations: 0,
                filePath: uri
            });

            if (result && result.testCode) {
                await applyTestEdit(uri, result.testCode);
            }
        } catch (error: any) {
            connection.window.showErrorMessage(`Sentinel Error: ${error.message}`);
        }
    }
});

// 2. TRIGGER: This runs every time you save a file in IntelliJ
documents.onDidSave(async (change) => {
    const document = change.document;
    const code = document.getText();
    const uri = document.uri;

    // Avoid self-triggering on test files
    if (uri.includes('.test.') || uri.includes('.spec.')) {
        return;
    }

    connection.console.log(`Sentinel Agent: Processing ${uri}...`);

    try {
        // 3. INVOKE AGENT: Call your LangGraph Self-Healing Logic
        const result = await testGenGraph.invoke({
            code: code,
            testCode: "",
            errors: [],
            iterations: 0
        });

        if (result.testCode) {
            connection.console.log(`Sentinel Agent: Test generated successfully.`);

            // 4. AUTOMATIC FILE CREATION: Tell IntelliJ to create the test file
            const testUri = uri.replace(/\.(ts|js|java)$/, '.test.$1');

            const workspaceEdit: WorkspaceEdit = {
                changes: {
                    [testUri]: [
                        {
                            range: Range.create(0, 0, 0, 0),
                            newText: result.testCode
                        }
                    ]
                }
            };

            // This pushes the generated code back into the IDE workspace
            await connection.workspace.applyEdit(workspaceEdit);
            connection.window.showInformationMessage(`Sentinel: Generated test for ${uri.split('/').pop()}`);
        }
    } catch (error) {
        connection.console.error(`Sentinel Error: ${error}`);
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