import * as vscode from 'vscode';

export class SidebarProvider implements vscode.WebviewViewProvider {
    constructor(private readonly _extensionUri: vscode.Uri) {}

    public resolveWebviewView(webviewView: vscode.WebviewView) {
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview();
    }

    private _getHtmlForWebview() {
        // We use CSS variables built into VS Code so it automatically 
        // matches whatever theme the user has installed (Dark/Light mode)!
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    body { font-family: var(--vscode-font-family); padding: 15px; color: var(--vscode-foreground); }
                    h2 { font-size: 16px; margin-bottom: 20px; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 5px; }
                    .agent-card { 
                        background: var(--vscode-editor-inactiveSelectionBackground); 
                        padding: 12px; 
                        border-radius: 6px; 
                        margin-bottom: 15px; 
                        border-left: 4px solid var(--vscode-terminal-ansiGreen); 
                    }
                    .agent-card h3 { margin: 0 0 5px 0; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.8;}
                    .status { font-size: 12px; font-weight: bold; }
                    .green { color: var(--vscode-terminal-ansiGreen); }
                </style>
            </head>
            <body>
                <h2>🛡️ Sentinel Network</h2>
                
                <div class="agent-card">
                    <h3>🧪 Agent 1: Test Gen</h3>
                    <div class="status green">● Online & Ready</div>
                </div>

                <div class="agent-card">
                    <h3>🏥 Agent 2: Code Healer</h3>
                    <div class="status green">● Online & Ready</div>
                </div>

                <div class="agent-card">
                    <h3>👀 Background Watcher</h3>
                    <div class="status green">● Active (Watching Saves)</div>
                </div>

                <div class="agent-card">
                    <h3>🧠 AST Dependency Scanner</h3>
                    <div class="status green">● Connected to ts-morph</div>
                </div>

                <hr style="border: none; border-top: 1px solid var(--vscode-panel-border); margin-top: 25px;" />
                <p style="font-size: 10px; opacity: 0.5; text-align: center;">LSP Engine Status: CONNECTED</p>
            </body>
            </html>
        `;
    }
}