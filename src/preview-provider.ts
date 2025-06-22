import * as vscode from "vscode";

export class PreviewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'view-tree-preview';

	private _view?: vscode.WebviewView;

	constructor(
		private readonly _extensionUri: vscode.Uri,
		private getProjectData: () => {
			componentsWithProperties: Map<string, { properties: Set<string>; file: string }>;
		},
	) {}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		this._view = webviewView;

		webviewView.webview.options = {
			// Allow scripts in the webview
			enableScripts: true,

			localResourceRoots: [
				this._extensionUri
			]
		};

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		// Listen for messages from the webview
		webviewView.webview.onDidReceiveMessage(data => {
			switch (data.type) {
				case 'refresh':
					this.refreshPreview();
					break;
				case 'selectComponent':
					this.selectComponent(data.component);
					break;
			}
		});

		// Listen for active editor changes
		vscode.window.onDidChangeActiveTextEditor(() => {
			this.updatePreview();
		});

		// Listen for text document changes
		vscode.workspace.onDidChangeTextDocument(e => {
			if (e.document.fileName.endsWith('.view.tree')) {
				this.updatePreview();
			}
		});

		// Initial preview
		this.updatePreview();
	}

	public updatePreview() {
		if (this._view) {
			const activeEditor = vscode.window.activeTextEditor;
			if (activeEditor && activeEditor.document.fileName.endsWith('.view.tree')) {
				const componentTree = this.parseActiveDocument();
				this._view.webview.postMessage({
					type: 'updatePreview',
					data: componentTree
				});
			}
		}
	}

	public refreshPreview() {
		this.updatePreview();
	}

	private parseActiveDocument() {
		const activeEditor = vscode.window.activeTextEditor;
		if (!activeEditor || !activeEditor.document.fileName.endsWith('.view.tree')) {
			return null;
		}

		const content = activeEditor.document.getText();
		const lines = content.split('\n');
		const components: ComponentNode[] = [];
		let currentComponent: ComponentNode | null = null;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const trimmed = line.trim();
			
			if (!trimmed || trimmed.startsWith('//')) {
				continue;
			}

			const indentLevel = this.getIndentLevel(line);
			
			if (indentLevel === 0 && trimmed.startsWith('$')) {
				const words = trimmed.split(/\s+/);
				const componentName = words[0];
				const params = words.slice(1).join(' ');
				
				currentComponent = {
					name: componentName,
					params: params,
					properties: [],
					children: [],
					line: i
				};
				components.push(currentComponent);
			} else if (indentLevel === 1 && currentComponent) {
				const property = this.parseProperty(line, i);
				if (property) {
					currentComponent.properties.push(property);
				}
			} else if (indentLevel >= 2 && currentComponent) {
				const child = this.parseChild(line, i, indentLevel);
				if (child) {
					currentComponent.children.push(child);
				}
			}
		}

		return components;
	}

	private parseProperty(line: string, lineNumber: number): PropertyNode | null {
		const trimmed = line.trim();
		
		// Skip bindings for now
		if (trimmed.includes('<=') || trimmed.includes('=>') || trimmed.includes('<=>')) {
			return {
				type: 'binding',
				name: trimmed,
				value: '',
				line: lineNumber
			};
		}

		const words = trimmed.split(/\s+/);
		const propertyName = words[0];
		const value = words.slice(1).join(' ');

		return {
			type: 'property',
			name: propertyName,
			value: value,
			line: lineNumber
		};
	}

	private parseChild(line: string, lineNumber: number, indentLevel: number): ChildNode | null {
		const trimmed = line.trim();
		
		if (trimmed.startsWith('$')) {
			return {
				type: 'component',
				name: trimmed,
				indent: indentLevel,
				line: lineNumber
			};
		} else {
			return {
				type: 'content',
				content: trimmed,
				indent: indentLevel,
				line: lineNumber
			};
		}
	}

	private getIndentLevel(line: string): number {
		const match = line.match(/^(\t*)/);
		return match ? match[1].length : 0;
	}

	private selectComponent(componentName: string) {
		// Find the component definition and navigate to it
		const projectData = this.getProjectData();
		const componentData = projectData.componentsWithProperties.get(componentName);
		
		if (componentData) {
			const uri = vscode.Uri.file(componentData.file);
			vscode.window.showTextDocument(uri);
		}
	}

	private _getHtmlForWebview(webview: vscode.Webview) {
		return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>View Tree Preview</title>
				<style>
					body {
						font-family: var(--vscode-font-family);
						font-size: var(--vscode-font-size);
						color: var(--vscode-foreground);
						background-color: var(--vscode-editor-background);
						margin: 0;
						padding: 10px;
					}
					
					.component {
						border: 1px solid var(--vscode-panel-border);
						border-radius: 4px;
						margin: 5px 0;
						padding: 8px;
						background-color: var(--vscode-editor-background);
					}
					
					.component-header {
						font-weight: bold;
						color: var(--vscode-symbolIcon-classForeground);
						cursor: pointer;
						margin-bottom: 8px;
					}
					
					.component-header:hover {
						text-decoration: underline;
					}
					
					.properties {
						margin-left: 15px;
						margin-bottom: 8px;
					}
					
					.property {
						margin: 3px 0;
						font-family: var(--vscode-editor-font-family);
					}
					
					.property-name {
						color: var(--vscode-symbolIcon-propertyForeground);
						font-weight: 500;
					}
					
					.property-value {
						color: var(--vscode-symbolIcon-stringForeground);
						margin-left: 8px;
					}
					
					.binding {
						color: var(--vscode-symbolIcon-operatorForeground);
						font-style: italic;
					}
					
					.children {
						margin-left: 15px;
						border-left: 2px solid var(--vscode-panel-border);
						padding-left: 8px;
					}
					
					.child-component {
						color: var(--vscode-symbolIcon-classForeground);
						margin: 2px 0;
						cursor: pointer;
					}
					
					.child-component:hover {
						text-decoration: underline;
					}
					
					.child-content {
						color: var(--vscode-symbolIcon-textForeground);
						margin: 2px 0;
						font-style: italic;
					}
					
					.toolbar {
						margin-bottom: 10px;
						padding: 5px 0;
						border-bottom: 1px solid var(--vscode-panel-border);
					}
					
					.refresh-btn {
						background-color: var(--vscode-button-background);
						color: var(--vscode-button-foreground);
						border: none;
						padding: 6px 12px;
						border-radius: 2px;
						cursor: pointer;
						font-size: 12px;
					}
					
					.refresh-btn:hover {
						background-color: var(--vscode-button-hoverBackground);
					}
					
					.empty-state {
						text-align: center;
						color: var(--vscode-descriptionForeground);
						margin-top: 50px;
					}

					.indent-guide {
						border-left: 1px dotted var(--vscode-panel-border);
						margin-left: 10px;
						padding-left: 10px;
					}
				</style>
			</head>
			<body>
				<div class="toolbar">
					<button class="refresh-btn" onclick="refreshPreview()">Refresh</button>
				</div>
				<div id="preview-content">
					<div class="empty-state">
						<p>Open a .view.tree file to see preview</p>
					</div>
				</div>

				<script>
					const vscode = acquireVsCodeApi();
					
					function refreshPreview() {
						vscode.postMessage({ type: 'refresh' });
					}
					
					function selectComponent(componentName) {
						vscode.postMessage({ 
							type: 'selectComponent', 
							component: componentName 
						});
					}
					
					window.addEventListener('message', event => {
						const message = event.data;
						
						switch (message.type) {
							case 'updatePreview':
								updatePreviewContent(message.data);
								break;
						}
					});
					
					function updatePreviewContent(components) {
						const content = document.getElementById('preview-content');
						
						if (!components || components.length === 0) {
							content.innerHTML = '<div class="empty-state"><p>No components found</p></div>';
							return;
						}
						
						let html = '';
						for (const component of components) {
							html += renderComponent(component);
						}
						
						content.innerHTML = html;
					}
					
					function renderComponent(component) {
						let html = '<div class="component">';
						
						// Component header
						html += '<div class="component-header" onclick="selectComponent(\'' + 
								component.name + '\')">' + 
								component.name;
						if (component.params) {
							html += ' <span style="font-weight: normal; color: var(--vscode-descriptionForeground);">' + 
									component.params + '</span>';
						}
						html += '</div>';
						
						// Properties
						if (component.properties && component.properties.length > 0) {
							html += '<div class="properties">';
							for (const prop of component.properties) {
								if (prop.type === 'binding') {
									html += '<div class="property binding">' + prop.name + '</div>';
								} else {
									html += '<div class="property">';
									html += '<span class="property-name">' + prop.name + '</span>';
									if (prop.value) {
										html += '<span class="property-value">' + prop.value + '</span>';
									}
									html += '</div>';
								}
							}
							html += '</div>';
						}
						
						// Children
						if (component.children && component.children.length > 0) {
							html += '<div class="children">';
							for (const child of component.children) {
								if (child.type === 'component') {
									html += '<div class="child-component" onclick="selectComponent(\'' + 
											child.name + '\')">' + 
											'  '.repeat(Math.max(0, child.indent - 2)) + child.name + '</div>';
								} else {
									html += '<div class="child-content">' + 
											'  '.repeat(Math.max(0, child.indent - 2)) + child.content + '</div>';
								}
							}
							html += '</div>';
						}
						
						html += '</div>';
						return html;
					}
				</script>
			</body>
			</html>`;
	}
}

interface ComponentNode {
	name: string;
	params: string;
	properties: PropertyNode[];
	children: ChildNode[];
	line: number;
}

interface PropertyNode {
	type: 'property' | 'binding';
	name: string;
	value: string;
	line: number;
}

interface ChildNode {
	type: 'component' | 'content';
	name?: string;
	content?: string;
	indent: number;
	line: number;
}
