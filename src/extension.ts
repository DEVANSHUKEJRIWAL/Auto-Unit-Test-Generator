import * as path from 'path';
import * as vscode from 'vscode';
import { ExtensionContext } from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient/node';

let client: LanguageClient;

export function activate(context: ExtensionContext) {
    // 1. Path to your compiled Server "Brain"
    vscode.window.showInformationMessage('SENTINEL IS ALIVE!');

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
}

export function deactivate(): Thenable<void> | undefined {
    return client ? client.stop() : undefined;
}