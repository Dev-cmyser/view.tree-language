import * as vscode from "vscode";

export class RenameProvider implements vscode.RenameProvider {
	constructor(
		private getProjectData: () => {
			componentsWithProperties: Map<string, { properties: Set<string>; file: string }>;
		},
		private refreshProjectData: () => Promise<void>,
	) {}

	async prepareRename(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken,
	): Promise<vscode.Range | { range: vscode.Range; placeholder: string } | undefined> {
		// Используем встроенный API для поиска слова с кастомным регексом
		const wordRange = document.getWordRangeAtPosition(position, /\$?\w+/);
		if (!wordRange) return undefined;

		const word = document.getText(wordRange);

		// Можем переименовывать только $компоненты
		if (word.startsWith("$")) {
			const projectData = this.getProjectData();
			if (projectData.componentsWithProperties.has(word)) {
				return {
					range: wordRange,
					placeholder: word,
				};
			}
		}

		return undefined;
	}

	async provideRenameEdits(
		document: vscode.TextDocument,
		position: vscode.Position,
		newName: string,
		token: vscode.CancellationToken,
	): Promise<vscode.WorkspaceEdit | undefined> {
		// Получаем старое имя компонента
		const wordRange = document.getWordRangeAtPosition(position, /\$?\w+/);
		if (!wordRange) return undefined;

		const oldName = document.getText(wordRange);
		if (!oldName.startsWith("$")) return undefined;

		// Валидируем новое имя
		if (!newName.startsWith("$")) {
			newName = "$" + newName;
		}

		if (!/^\$[a-zA-Z_][a-zA-Z0-9_]*$/.test(newName)) {
			vscode.window.showErrorMessage("Invalid component name. Use only letters, numbers and underscores.");
			return undefined;
		}

		// Проверяем, что новое имя не конфликтует с существующими
		const projectData = this.getProjectData();
		if (projectData.componentsWithProperties.has(newName)) {
			vscode.window.showErrorMessage(`Component '${newName}' already exists.`);
			return undefined;
		}

		// Создаем WorkspaceEdit для всех изменений
		const workspaceEdit = new vscode.WorkspaceEdit();

		try {
			// Находим все вхождения компонента в проекте
			const allOccurrences = await this.findAllOccurrences(oldName);

			// Группируем изменения по файлам
			const changesByFile = new Map<string, vscode.TextEdit[]>();

			for (const occurrence of allOccurrences) {
				const filePath = occurrence.uri.fsPath;
				if (!changesByFile.has(filePath)) {
					changesByFile.set(filePath, []);
				}

				const edit = new vscode.TextEdit(occurrence.range, newName);
				changesByFile.get(filePath)!.push(edit);
			}

			// Применяем изменения к каждому файлу
			for (const [filePath, edits] of changesByFile) {
				const uri = vscode.Uri.file(filePath);
				workspaceEdit.set(uri, edits);
			}

			// Если компонент определен в отдельном файле, переименовываем файлы
			const componentData = projectData.componentsWithProperties.get(oldName);
			if (componentData) {
				const fileRenames = await this.createFileRenames(oldName, newName, componentData.file);
				for (const [oldUri, newUri] of fileRenames) {
					workspaceEdit.renameFile(oldUri, newUri);
				}
			}

			return workspaceEdit;
		} catch (error) {
			vscode.window.showErrorMessage(`Error during rename: ${error}`);
			return undefined;
		}
	}

	private async findAllOccurrences(componentName: string): Promise<vscode.Location[]> {
		const locations: vscode.Location[] = [];

		if (!vscode.workspace.workspaceFolders) {
			return locations;
		}

		// Ищем в .view.tree файлах
		const viewTreeFiles = await vscode.workspace.findFiles("**/*.view.tree", "**/node_modules/**");
		for (const file of viewTreeFiles) {
			const occurrences = await this.findOccurrencesInFile(file, componentName);
			locations.push(...occurrences);
		}

		// Ищем в .ts файлах
		const tsFiles = await vscode.workspace.findFiles("**/*.ts", "**/node_modules/**");
		for (const file of tsFiles) {
			if (file.path.endsWith(".d.ts")) continue;
			const occurrences = await this.findOccurrencesInFile(file, componentName);
			locations.push(...occurrences);
		}

		return locations;
	}

	private async findOccurrencesInFile(uri: vscode.Uri, componentName: string): Promise<vscode.Location[]> {
		const locations: vscode.Location[] = [];

		try {
			const buffer = await vscode.workspace.fs.readFile(uri);
			const content = buffer.toString();
			const lines = content.split("\n");

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				let startIndex = 0;

				// Ищем все вхождения в строке
				while (true) {
					const index = line.indexOf(componentName, startIndex);
					if (index === -1) break;

					// Проверяем, что это отдельное слово (не часть другого слова)
					const before = index > 0 ? line[index - 1] : " ";
					const after = index + componentName.length < line.length ? line[index + componentName.length] : " ";

					if (this.isWordBoundary(before) && this.isWordBoundary(after)) {
						const range = new vscode.Range(
							i,
							index,
							i,
							index + componentName.length
						);
						locations.push(new vscode.Location(uri, range));
					}

					startIndex = index + 1;
				}
			}
		} catch (error) {
			console.log(`[view.tree] Error reading file for rename ${uri.path}:`, error);
		}

		return locations;
	}

	private isWordBoundary(char: string): boolean {
		return /\s|[^\w$]/.test(char);
	}

	private async createFileRenames(oldName: string, newName: string, componentFile: string): Promise<[vscode.Uri, vscode.Uri][]> {
		const renames: [vscode.Uri, vscode.Uri][] = [];

		// Получаем базовое имя без $
		const oldBaseName = oldName.substring(1);
		const newBaseName = newName.substring(1);

		// Определяем директорию компонента
		const componentDir = componentFile.substring(0, componentFile.lastIndexOf('/'));
		
		// Создаем список файлов для переименования
		const fileExtensions = ['.ts', '.view.tree', '.view.ts', '.view.css.ts', '.test.ts'];
		
		for (const ext of fileExtensions) {
			const oldPath = `${componentDir}/${oldBaseName}${ext}`;
			const newPath = `${componentDir}/${newBaseName}${ext}`;
			
			const oldUri = vscode.Uri.file(oldPath);
			const newUri = vscode.Uri.file(newPath);
			
			// Проверяем, существует ли файл
			try {
				await vscode.workspace.fs.stat(oldUri);
				renames.push([oldUri, newUri]);
			} catch {
				// Файл не существует, пропускаем
			}
		}

		// Если компонент находится в собственной директории, переименовываем и её
		const dirName = componentDir.substring(componentDir.lastIndexOf('/') + 1);
		if (dirName === oldBaseName) {
			const parentDir = componentDir.substring(0, componentDir.lastIndexOf('/'));
			const oldDirUri = vscode.Uri.file(componentDir);
			const newDirUri = vscode.Uri.file(`${parentDir}/${newBaseName}`);
			
			// Для директорий используем отдельный подход
			// так как VSCode не всегда корректно переименовывает директории через WorkspaceEdit
			try {
				await vscode.workspace.fs.stat(oldDirUri);
				// Показываем пользователю информацию о необходимости переименования директории
				vscode.window.showInformationMessage(
					`Don't forget to rename directory '${oldBaseName}' to '${newBaseName}' manually.`
				);
			} catch {
				// Директория не существует
			}
		}

		return renames;
	}
}
