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

		// Получаем первый не-пробельный символ на текущей строке
		const trimmedLine = lineText.trim();
		const firstChar = trimmedLine.charAt(0);

		// Если каретка в слове, начинающемся с "$" — предлагаем компоненты
		const wordRange =
			document.getWordRangeAtPosition(position, /[$\w]+/) ??
			document.getWordRangeAtPosition(position.translate(0, -1), /[$\w]+/); // на случай каретки в конце слова

		if (wordRange && document.getText(wordRange).startsWith("$")) {
			return this.getComponentCompletions(/* можно передать wordRange для replace */);
		}

		// Если любой другой символ (или пустая строка) - предлагаем свойства
		if (firstChar !== "$") {
			const currentComponent = this.getCurrentComponent(document, position);
			if (currentComponent) {
				return this.getPropertyCompletions(currentComponent);
			}
		}

		return undefined;
	}

	private getCurrentComponent(document: vscode.TextDocument, position: vscode.Position): string | null {
		// Ищем текущую строку и проверяем, есть ли в ней биндинг
		const currentLine = document.lineAt(position.line);
		const currentText = currentLine.text.trim();
		const hasBinding = currentText.includes("<=") || currentText.includes("=>") || currentText.includes("<=>");

		// Ищем ближайший компонент вверх от текущей позиции
		for (let i = position.line - 1; i >= 0; i--) {
			const line = document.lineAt(i);
			const lineText = line.text.trim();

			if (lineText.includes("$")) {
				const words = lineText.split(/\s+/);
				for (let j = words.length - 1; j >= 0; j--) {
					if (words[j].startsWith("$")) {
						// Если есть биндинг, возвращаем корневой компонент
						if (hasBinding && i > 0) {
							continue;
						}
						return words[j];
					}
				}
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

		console.log("ASDASDAADASD", componentName);
		console.log(componentData?.properties);
		console.log(componentData?.file);
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
					completion.insertText = new vscode.SnippetString(`${property} /\n\t\t$0`);
				} else {
					// Для обычных свойств
					completion.insertText = new vscode.SnippetString(`${property} $0`);
				}

				completions.push(completion);
			}
		}

		// Добавляем специальные синтаксические элементы view.tree
		const syntaxElements = [
			{ name: "<=", desc: "One-way binding (property <= source)", insertText: "<= ${1:property}" },
			{ name: "=>", desc: "Output binding (property => target)", insertText: "=> ${1:target}" },
			{ name: "<=>", desc: "Two-way binding (property <=> other)", insertText: "<=> ${1:property}" },
			{ name: "/", desc: "Empty list declaration", insertText: "/\n\t\t$0" },
			{ name: "*", desc: "Dictionary/map declaration", insertText: "*\n\t\t$0" },
			{ name: "@", desc: "Localization marker", insertText: "@ \\${1:text}" },
			{ name: "\\", desc: "Raw string literal", insertText: "\\${1:text}" },
		];

		for (const element of syntaxElements) {
			const completion = new vscode.CompletionItem(element.name, vscode.CompletionItemKind.Keyword);
			completion.detail = element.desc;
			completion.documentation = new vscode.MarkdownString(`**${element.name}** - ${element.desc}`);
			completion.insertText = new vscode.SnippetString(element.insertText);
			completion.sortText = "y" + element.name; // Помещаем перед общими свойствами
			completions.push(completion);
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
