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
		console.log("[DefinitionProvider] provideDefinition called");
		console.log("[DefinitionProvider] Position:", position.line, position.character);

		const line = document.lineAt(position.line).text;
		const character = position.character;

		// Определяем слово с учетом $ символа
		let wordStart = character;
		let wordEnd = character;

		// Ищем начало слова (включая $)
		while (wordStart > 0 && /[\w$]/.test(line[wordStart - 1])) {
			wordStart--;
		}

		// Ищем конец слова
		while (wordEnd < line.length && /[\w]/.test(line[wordEnd])) {
			wordEnd++;
		}

		const word = line.substring(wordStart, wordEnd);
		console.log("[DefinitionProvider] Word:", word);
		console.log("[DefinitionProvider] Line:", line);
		console.log("[DefinitionProvider] Word range:", wordStart, "-", wordEnd);

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
			const componentData = projectData.componentsWithProperties.get(currentComponent)!;
			console.log("[DefinitionProvider] Component properties:", Array.from(componentData.properties));
			console.log("[DefinitionProvider] Component file:", componentData.file);

			if (componentData.properties.has(word)) {
				console.log("[DefinitionProvider] Found property:", word, "in component:", currentComponent);
				return this.findPropertyDefinition(currentComponent, word, componentData.file);
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

		// Сначала проверяем, есть ли компонент в нашей мапе
		const projectData = this.getProjectData();
		if (projectData.componentsWithProperties.has(componentName)) {
			const componentData = projectData.componentsWithProperties.get(componentName)!;
			console.log("[DefinitionProvider] Found component in map, file:", componentData.file);

			// Используем известный файл компонента
			const componentUri = vscode.Uri.file(componentData.file);

			if (componentData.file.endsWith(".ts")) {
				// Ищем объявление класса в .ts файле
				try {
					const buffer = await vscode.workspace.fs.readFile(componentUri);
					const content = buffer.toString();
					const lines = content.split("\n");

					console.log("[DefinitionProvider] Searching for class declaration in:", componentData.file);

					for (let i = 0; i < lines.length; i++) {
						if (lines[i].includes(`export class ${componentName}`)) {
							const location = new vscode.Location(componentUri, new vscode.Position(i, 0));
							console.log("[DefinitionProvider] Found class declaration at line:", i);
							return location;
						}
					}
				} catch (error) {
					console.log("[DefinitionProvider] Error reading component file:", error);
				}
			}

			// Для .view.tree файлов или если не нашли класс, возвращаем начало файла
			const location = new vscode.Location(componentUri, new vscode.Position(0, 0));
			console.log("[DefinitionProvider] Returning component file location:", componentData.file);
			return location;
		}

		// Если компонент не найден в мапе, пробуем поиск по паттернам
		console.log("[DefinitionProvider] Component not found in map, trying file patterns");

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
		componentFile: string,
	): Promise<vscode.Definition | undefined> {
		console.log(
			"[DefinitionProvider] Finding property definition for:",
			propertyName,
			"in component:",
			componentName,
			"from file:",
			componentFile,
		);

		// Используем известный файл компонента
		const componentUri = vscode.Uri.file(componentFile);

		try {
			const buffer = await vscode.workspace.fs.readFile(componentUri);
			const content = buffer.toString();
			const lines = content.split("\n");

			console.log("[DefinitionProvider] Searching for property in component file:", componentFile);

			if (componentFile.endsWith(".view.tree")) {
				// Поиск в .view.tree файле
				for (let i = 0; i < lines.length; i++) {
					const line = lines[i];
					// Ищем свойство с одним табом в начале
					const regex = new RegExp(`^\\t${propertyName}\\s*$`);
					if (line.match(regex)) {
						const location = new vscode.Location(componentUri, new vscode.Position(i, 1));
						console.log("[DefinitionProvider] Found property in view tree at line:", i);
						return location;
					}
				}
			} else if (componentFile.endsWith(".ts")) {
				// Поиск в .ts файле
				for (let i = 0; i < lines.length; i++) {
					const line = lines[i];
					// Ищем метод с двумя табами
					const regex = new RegExp(`^\\t\\t${propertyName}\\s*\\(`);
					if (line.match(regex)) {
						const location = new vscode.Location(componentUri, new vscode.Position(i, 2));
						console.log("[DefinitionProvider] Found property method in TS at line:", i);
						return location;
					}
				}
			}
		} catch (error) {
			console.log("[DefinitionProvider] Error reading component file:", error);
		}

		console.log("[DefinitionProvider] No property definition found in component file");
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
