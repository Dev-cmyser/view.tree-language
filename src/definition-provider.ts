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
		const line = document.lineAt(position.line).text;
		const character = position.character;

		// Определяем слово с учетом $ символа
		let wordStart = character;
		let wordEnd = character;

		while (wordStart > 0 && /[\w$]/.test(line[wordStart - 1])) {
			wordStart--;
		}
		while (wordEnd < line.length && /[\w]/.test(line[wordEnd])) {
			wordEnd++;
		}

		const word = line.substring(wordStart, wordEnd);

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
