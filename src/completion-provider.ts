import * as vscode from "vscode";

export class CompletionProvider implements vscode.CompletionItemProvider {
	constructor(
		private getProjectData: () => {
			componentsWithProperties: Map<string, { properties: Set<string>; file: string }>;
		},
	) {}

	async provideCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken,
		context: vscode.CompletionContext,
	): Promise<vscode.CompletionItem[] | vscode.CompletionList | undefined> {
		const line = document.lineAt(position);
		const lineText = line.text;

		// Проверяем, что мы находимся в .view.tree файле
		if (!document.fileName.endsWith(".view.tree")) {
			return undefined;
		}

		// Определяем уровень отступов
		const indentLevel = this.getIndentLevel(lineText);

		// Если мы на первом уровне (без отступов), предлагаем компоненты
		if (indentLevel === 0) {
			return this.getComponentCompletions();
		}

		// Если мы на втором уровне (один таб), предлагаем свойства текущего компонента
		if (indentLevel === 1) {
			const currentComponent = this.getCurrentComponent(document, position);
			if (currentComponent) {
				return this.getPropertyCompletions(currentComponent);
			}
		}

		return undefined;
	}

	private getIndentLevel(lineText: string): number {
		const match = lineText.match(/^(\t*)/);
		return match ? match[1].length : 0;
	}

	private getCurrentComponent(document: vscode.TextDocument, position: vscode.Position): string | null {
		// Ищем ближайший компонент вверх от текущей позиции
		for (let i = position.line - 1; i >= 0; i--) {
			const line = document.lineAt(i);
			const lineText = line.text.trim();

			// Если строка без отступов и начинается с $
			if (!line.text.startsWith("\t") && lineText.startsWith("$")) {
				const words = lineText.split(/\s+/);
				return words[0];
			}
		}
		return null;
	}

	private getComponentCompletions(): vscode.CompletionItem[] {
		const projectData = this.getProjectData();
		const completions: vscode.CompletionItem[] = [];

		for (const [componentName, componentData] of projectData.componentsWithProperties) {
			const completion = new vscode.CompletionItem(componentName, vscode.CompletionItemKind.Class);
			completion.detail = `Component from ${componentData.file}`;
			completion.documentation = new vscode.MarkdownString(
				`**${componentName}**\n\nAvailable properties: ${Array.from(componentData.properties).join(", ")}`,
			);

			// Добавляем snippet для автоматического перехода на следующую строку
			completion.insertText = new vscode.SnippetString(`${componentName}\n\t$0`);
			completion.command = { command: "vscode.executeCompletionItemProvider", title: "Re-trigger completions" };

			completions.push(completion);
		}

		return completions;
	}

	private getPropertyCompletions(componentName: string): vscode.CompletionItem[] {
		const projectData = this.getProjectData();
		const componentData = projectData.componentsWithProperties.get(componentName);
		const completions: vscode.CompletionItem[] = [];

		if (componentData) {
			for (const property of componentData.properties) {
				const completion = new vscode.CompletionItem(property, vscode.CompletionItemKind.Property);
				completion.detail = `Property of ${componentName}`;
				completion.documentation = new vscode.MarkdownString(
					`Property **${property}** from component **${componentName}**`,
				);

				// Добавляем разные типы вставки в зависимости от контекста
				if (property.endsWith("?")) {
					// Для boolean свойств
					completion.insertText = new vscode.SnippetString(`${property} \${1|true,false|}`);
				} else if (property === "sub" || property === "content") {
					// Для свойств которые обычно содержат вложенные элементы
					completion.insertText = new vscode.SnippetString(`${property}\n\t\t$0`);
				} else {
					// Для обычных свойств
					completion.insertText = new vscode.SnippetString(`${property} $0`);
				}

				completions.push(completion);
			}
		}

		return completions;
	}

	resolveCompletionItem(
		item: vscode.CompletionItem,
		token: vscode.CancellationToken,
	): vscode.ProviderResult<vscode.CompletionItem> {
		// Можно добавить дополнительную информацию при выборе элемента
		return item;
	}
}
