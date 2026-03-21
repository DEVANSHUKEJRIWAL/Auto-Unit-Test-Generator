import * as path from 'path';
import * as vscode from 'vscode';
import * as fs from 'fs';
import { ExtensionContext } from 'vscode';
import { SidebarProvider } from './SidebarProvider';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient/node';

// FIX: Tell TypeScript it's okay for the client to be undefined at startup
let client: LanguageClient | undefined;

// ==========================================
// 🎨 1. CREATE THE PAINTBRUSHES
// ==========================================
const coveredDecorationType = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(0, 255, 0, 0.15)', 
    isWholeLine: true
});

const uncoveredDecorationType = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(255, 0, 0, 0.15)', 
    isWholeLine: true
});

export function activate(context: ExtensionContext) {
    vscode.window.showInformationMessage('SENTINEL IS ALIVE!');

    // 1. Path to your compiled Server "Brain"
    const serverModule = context.asAbsolutePath(
        path.join('sentinel-ls', 'dist', 'server.js')
    );

    console.log(`Checking path: ${serverModule}`);

    // This ensures errors from the server are sent to the main VS Code window
    const serverOptions: ServerOptions = {
        run: { module: serverModule, transport: TransportKind.ipc },
        debug: { 
            module: serverModule, 
            transport: TransportKind.ipc,
            options: { execArgv: ['--nolazy', '--inspect=6009'] } 
        }
    };

    // 3. Which files should trigger the server?
    const clientOptions: LanguageClientOptions = {
        documentSelector: [
            { scheme: 'file', language: 'typescript' },
            { scheme: 'file', language: 'java' }
        ]
    };

    client = new LanguageClient('sentinelServer', 'Sentinel LSP Server', serverOptions, clientOptions);
    client.start();

    // Initialize the Webview Sidebar
    const sidebarProvider = new SidebarProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider("sentinel-agent-status", sidebarProvider)
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('sentinel.promptRequirements', async (uri, range) => {
            const requirements = await vscode.window.showInputBox({
                prompt: "🧠 Sentinel: What is the intended behavior of this code? (Leave blank to let AI guess)",
                placeHolder: "e.g., It subtracts the discount from the price and throws an error if negative."
            });

            if (requirements === undefined) return;

            vscode.commands.executeCommand('sentinel.generateTestForLine', uri, range, requirements);
        })
    );

    // ==========================================
    // 🗺️ 2. THE LIVE COVERAGE PAINTER
    // ==========================================
    function paintCoverageHeatmap() {
        console.log("🎨 [Sentinel] Paint function triggered!");

        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            console.log("🎨 [Sentinel] Aborting: No active text editor.");
            return; 
        }

        const document = editor.document;
        const filePath = document.uri.fsPath;
        console.log("🎨 [Sentinel] Trying to paint file:", filePath);

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            console.log("🎨 [Sentinel] Aborting: No workspace folder open.");
            return;
        }
        
        const coveragePath = path.join(workspaceFolders[0].uri.fsPath, 'coverage', 'coverage-final.json');

        if (!fs.existsSync(coveragePath)) {
            console.log("🎨 [Sentinel] No coverage file found at", coveragePath);
            return;
        }

        try {
            const coverageData = JSON.parse(fs.readFileSync(coveragePath, 'utf8'));
            
            // 🛡️ BULLETPROOF PATH MATCHING
            const fileCoverageKey = Object.keys(coverageData).find(key => {
                return path.normalize(key).toLowerCase() === path.normalize(filePath).toLowerCase();
            });

            if (!fileCoverageKey) {
                console.log(`🎨 [Sentinel] Coverage JSON found, but no data for ${filePath}`);
                return; 
            }

            const fileCoverage = coverageData[fileCoverageKey];
            
            const coveredRanges: vscode.Range[] = [];
            const uncoveredRanges: vscode.Range[] = [];

            const statements = fileCoverage.statementMap;
            const hits = fileCoverage.s;

            for (const key in statements) {
                const statement = statements[key];
                const startLine = Math.max(0, statement.start.line - 1); 
                const endLine = Math.max(0, statement.end.line - 1);

                const range = new vscode.Range(startLine, 0, endLine, 0);

                if (hits[key] > 0) {
                    coveredRanges.push(range); 
                } else {
                    uncoveredRanges.push(range); 
                }
            }

            editor.setDecorations(coveredDecorationType, coveredRanges);
            editor.setDecorations(uncoveredDecorationType, uncoveredRanges);
            
            console.log(`✅ [Sentinel] Successfully painted ${coveredRanges.length} green lines and ${uncoveredRanges.length} red lines!`);

        } catch (err) {
            console.error("❌ [Sentinel] Failed to parse coverage JSON", err);
        }
    }

    // ==========================================
    // ⚡ 3. WIRE UP THE TRIGGERS
    // ==========================================
    vscode.window.onDidChangeActiveTextEditor(paintCoverageHeatmap, null, context.subscriptions);
    
    const watcher = vscode.workspace.createFileSystemWatcher('**/coverage/coverage-final.json');
    watcher.onDidChange(paintCoverageHeatmap, null, context.subscriptions);
    watcher.onDidCreate(paintCoverageHeatmap, null, context.subscriptions);
    
    paintCoverageHeatmap();
}

export function deactivate(): Thenable<void> | undefined {
    return client ? client.stop() : undefined;
}