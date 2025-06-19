import * as vscode from "vscode";

export class DefinitionProvider implements vscode.DefinitionProvider {
	constructor(
		private getProjectData: () => {
			componentsWithProperties: Map<string, { properties: Set<string>; file: string }>;
		},
	) {}

	async provideDefinition(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken,
	): Promise<vscode.Definition | undefined> {
		// Используем встроенный API для поиска слова с кастомным регексом
		const wordRange = document.getWordRangeAtPosition(position, /\$?\w+/);
		if (!wordRange) return undefined;

		const word = document.getText(wordRange);

		// Если это $компонент
		if (word.startsWith("$")) {
			return this.findComponentDefinition(word);
		}
	}

	private async findComponentDefinition(componentName: string): Promise<vscode.Definition | undefined> {
		const projectData = this.getProjectData();
		const componentData = projectData.componentsWithProperties.get(componentName);

		if (componentData) {
			const componentUri = vscode.Uri.file(componentData.file);
			return new vscode.Location(componentUri, new vscode.Position(0, 0));
		}

		return undefined;
	}
}
