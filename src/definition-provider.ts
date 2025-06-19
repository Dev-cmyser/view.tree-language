import * as vscode from "vscode";

export class DefinitionProvider implements vscode.DefinitionProvider {
	constructor(private getProjectData: () => { componentsWithProperties: Map<string, Set<string>> }) {}

	async provideDefinition(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken,
	): Promise<vscode.Definition | undefined> {
		console.log("[DefinitionProvider] provideDefinition called");
		console.log("[DefinitionProvider] Position:", position.line, position.character);

		const wordRange = document.getWordRangeAtPosition(position);
		if (!wordRange) {
			console.log("[DefinitionProvider] No word range found");
			return undefined;
		}

		const word = document.getText(wordRange);
		const line = document.lineAt(position.line).text;

		console.log("[DefinitionProvider] Word:", word);
		console.log("[DefinitionProvider] Line:", line);

		// Проверяем, является ли слово $компонентом
		if (word.startsWith("$")) {
			console.log("[DefinitionProvider] Found component:", word);
			return this.findComponentDefinition(word);
		}

		// Проверяем, является ли слово свойством компонента
		const currentComponent = this.getCurrentComponent(document, position);
		console.log("[DefinitionProvider] Current component:", currentComponent);

		const projectData = this.getProjectData();
		console.log(
			"[DefinitionProvider] Project data components:",
			Array.from(projectData.componentsWithProperties.keys()),
		);

		if (currentComponent && projectData.componentsWithProperties.has(currentComponent)) {
			const properties = projectData.componentsWithProperties.get(currentComponent)!;
			console.log("[DefinitionProvider] Component properties:", Array.from(properties));

			if (properties.has(word)) {
				console.log("[DefinitionProvider] Found property:", word, "in component:", currentComponent);
				return this.findPropertyDefinition(currentComponent, word);
			} else {
				console.log("[DefinitionProvider] Property not found in component");
			}
		} else {
			console.log("[DefinitionProvider] Component not found in project data");
		}

		console.log("[DefinitionProvider] No definition found");
		return undefined;
	}

	private async findComponentDefinition(componentName: string): Promise<vscode.Definition | undefined> {
		console.log("[DefinitionProvider] Finding component definition for:", componentName);

		// Ищем .view.tree файл для компонента
		const viewTreePattern = `**/${componentName.substring(1).replace(/_/g, "/")}*.view.tree`;
		console.log("[DefinitionProvider] View tree pattern:", viewTreePattern);

		const viewTreeFiles = await vscode.workspace.findFiles(viewTreePattern);
		console.log(
			"[DefinitionProvider] Found view tree files:",
			viewTreeFiles.map((f) => f.path),
		);

		if (viewTreeFiles.length > 0) {
			const location = new vscode.Location(viewTreeFiles[0], new vscode.Position(0, 0));
			console.log("[DefinitionProvider] Returning view tree location:", viewTreeFiles[0].path);
			return location;
		}

		// Ищем .ts файл для компонента
		const tsPattern = `**/${componentName.substring(1).replace(/_/g, "/")}*.ts`;
		console.log("[DefinitionProvider] TS pattern:", tsPattern);

		const tsFiles = await vscode.workspace.findFiles(tsPattern);
		console.log(
			"[DefinitionProvider] Found TS files:",
			tsFiles.map((f) => f.path),
		);

		if (tsFiles.length > 0) {
			// Ищем строку с объявлением класса
			const buffer = await vscode.workspace.fs.readFile(tsFiles[0]);
			const content = buffer.toString();
			const lines = content.split("\n");

			console.log("[DefinitionProvider] Searching for class declaration in:", tsFiles[0].path);

			for (let i = 0; i < lines.length; i++) {
				if (lines[i].includes(`export class ${componentName}`)) {
					const location = new vscode.Location(tsFiles[0], new vscode.Position(i, 0));
					console.log("[DefinitionProvider] Found class declaration at line:", i);
					return location;
				}
			}

			// Если не нашли объявление класса, возвращаем начало файла
			const location = new vscode.Location(tsFiles[0], new vscode.Position(0, 0));
			console.log("[DefinitionProvider] Class declaration not found, returning file start");
			return location;
		}

		console.log("[DefinitionProvider] No component definition found");
		return undefined;
	}

	private async findPropertyDefinition(
		componentName: string,
		propertyName: string,
	): Promise<vscode.Definition | undefined> {
		console.log(
			"[DefinitionProvider] Finding property definition for:",
			propertyName,
			"in component:",
			componentName,
		);

		// Сначала ищем в .view.tree файле
		const viewTreePattern = `**/${componentName.substring(1).replace(/_/g, "/")}*.view.tree`;
		console.log("[DefinitionProvider] View tree pattern for property:", viewTreePattern);

		const viewTreeFiles = await vscode.workspace.findFiles(viewTreePattern);
		console.log(
			"[DefinitionProvider] Found view tree files for property:",
			viewTreeFiles.map((f) => f.path),
		);

		if (viewTreeFiles.length > 0) {
			const buffer = await vscode.workspace.fs.readFile(viewTreeFiles[0]);
			const content = buffer.toString();
			const lines = content.split("\n");

			console.log("[DefinitionProvider] Searching for property in view tree file");

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				// Ищем свойство с одним табом в начале
				const regex = new RegExp(`^\\t${propertyName}\\s*$`);
				if (line.match(regex)) {
					const location = new vscode.Location(viewTreeFiles[0], new vscode.Position(i, 1));
					console.log("[DefinitionProvider] Found property in view tree at line:", i);
					return location;
				}
			}
			console.log("[DefinitionProvider] Property not found in view tree file");
		}

		// Затем ищем в .ts файле
		const tsPattern = `**/${componentName.substring(1).replace(/_/g, "/")}*.ts`;
		console.log("[DefinitionProvider] TS pattern for property:", tsPattern);

		const tsFiles = await vscode.workspace.findFiles(tsPattern);
		console.log(
			"[DefinitionProvider] Found TS files for property:",
			tsFiles.map((f) => f.path),
		);

		if (tsFiles.length > 0) {
			const buffer = await vscode.workspace.fs.readFile(tsFiles[0]);
			const content = buffer.toString();
			const lines = content.split("\n");

			console.log("[DefinitionProvider] Searching for property method in TS file");

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				// Ищем метод с двумя табами
				const regex = new RegExp(`^\\t\\t${propertyName}\\s*\\(`);
				if (line.match(regex)) {
					const location = new vscode.Location(tsFiles[0], new vscode.Position(i, 2));
					console.log("[DefinitionProvider] Found property method in TS at line:", i);
					return location;
				}
			}
			console.log("[DefinitionProvider] Property method not found in TS file");
		}

		console.log("[DefinitionProvider] No property definition found");
		return undefined;
	}

	private getCurrentComponent(document: vscode.TextDocument, position: vscode.Position): string | null {
		console.log("[DefinitionProvider] Getting current component for position:", position.line, position.character);

		// Ищем ближайший компонент выше текущей позиции
		for (let i = position.line; i >= 0; i--) {
			const line = document.lineAt(i).text;
			const trimmed = line.trim();

			console.log("[DefinitionProvider] Checking line", i, ":", JSON.stringify(line));

			// Компонент должен начинаться без отступа и с символа $
			if (!line.startsWith("\t") && trimmed.startsWith("$")) {
				const firstWord = trimmed.split(/\s+/)[0];
				console.log("[DefinitionProvider] Found potential component:", firstWord);

				if (firstWord.startsWith("$")) {
					console.log("[DefinitionProvider] Returning current component:", firstWord);
					return firstWord;
				}
			}
		}

		console.log("[DefinitionProvider] No current component found");
		return null;
	}
}
