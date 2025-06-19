import * as vscode from "vscode";

interface ProjectData {
	components: Set<string>;
	componentProperties: Map<string, Set<string>>;
}

let projectData: ProjectData = {
	components: new Set(),
	componentProperties: new Map(),
};

async function scanProject(): Promise<ProjectData> {
	const molViewProps = new Set(["dom_name", "style", "event", "field", "attr", "sub", "title"]);
	const data: ProjectData = {
		components: new Set(),
		componentProperties: new Map([["$mol_view", molViewProps]]),
	};

	console.log("[view.tree] Starting project scan...");

	// Проверяем что workspace открыт
	if (!vscode.workspace.workspaceFolders) {
		console.log("[view.tree] No workspace folders found");
		return data;
	}

	// Сканируем .view.tree файлы
	const viewTreeFiles = await vscode.workspace.findFiles("**/*.view.tree", "**/node_modules/**");
	console.log(`[view.tree] Found ${viewTreeFiles.length} .view.tree files`);

	for (const file of viewTreeFiles) {
		try {
			const buffer = await vscode.workspace.fs.readFile(file);
			const content = buffer.toString();
			console.log(`[view.tree] Parsing ${file.path}`);
			parseViewTreeFile(content, data);
		} catch (error) {
			console.log(`[view.tree] Error reading ${file.path}:`, error);
		}
	}

	// Сканируем .ts файлы для поиска $mol компонентов
	const tsFiles = await vscode.workspace.findFiles("**/*.ts", "**/node_modules/**, **/-/**");
	console.log(`[view.tree] Found ${tsFiles.length} .ts files`);

	for (const file of tsFiles) {
		try {
			const buffer = await vscode.workspace.fs.readFile(file);
			const content = buffer.toString();
			parseTsFile(content, data);
		} catch (error) {
			console.log(`[view.tree] Error reading ${file.path}:`, error);
		}
	}

	console.log(
		`[view.tree] Scan complete: ${data.components.size} components, ${data.componentProperties.size} components with properties`,
	);
	console.log("[view.tree] Components props found:", Array.from(data.componentProperties));

	return data;
}

function parseViewTreeFile(content: string, data: ProjectData) {
	const lines = content.split("\n");
	let currentComponent: string | null = null;

	// Временная карта для сбора свойств текущего файла
	const tempProperties = new Map<string, Set<string>>();

	for (const line of lines) {
		const trimmed = line.trim();

		// Брать только первое слово из строк без отступа
		if (!line.startsWith("\t") && trimmed.startsWith("$")) {
			const words = trimmed.split(/\s+/);
			const firstWord = words[0];
			currentComponent = firstWord;
			data.components.add(firstWord);
			if (!tempProperties.has(firstWord)) {
				tempProperties.set(firstWord, new Set());
			}
		}

		// Ищем свойства компонента
		if (currentComponent) {
			// Проверяем узлы на первом уровне отступа (один таб)
			const firstLevelMatch = line.match(/^\t([a-zA-Z_][a-zA-Z0-9_?*]*)/);
			if (firstLevelMatch) {
				// Добавляем первое слово как свойство без дополнительных проверок
				const property = firstLevelMatch[1];

				const bindingRightSideMatches = [...line.matchAll(/(?:<=|<=>|=>)\s*([a-zA-Z_][a-zA-Z0-9_?*]*)/g)];
				// todo дописать добавление свойства в tempProperties
			}
		}
	}

	for (const [component, properties] of tempProperties) {
		data.componentProperties.set(component, properties);
	}
}

function parseTsFile(content: string, data: ProjectData) {
	// Ищем все $ компоненты в TypeScript файлах
	const componentMatches = content.match(/\$\w+/g);
	if (componentMatches) {
		for (const match of componentMatches) {
			data.components.add(match);
		}
	}
	// todo искать и свойства компонентов (регекс - два таба + имя функции соответвенно надо вытащить имя функции)
	// examples
	// 		maximal_width() {
	// 			return this.minimal_width()

	//		minimal_height() {
}

async function refreshProjectData() {
	console.log("[view.tree] Refreshing project data...");
	projectData = await scanProject();
}

async function updateSingleFile(uri: vscode.Uri) {
	console.log(`[view.tree] Updating single file: ${uri.path}`);
	try {
		const buffer = await vscode.workspace.fs.readFile(uri);
		const content = buffer.toString();

		if (uri.path.endsWith(".view.tree")) {
			parseViewTreeFile(content, projectData);
		} else if (uri.path.endsWith(".ts")) {
			parseTsFile(content, projectData);
		}
	} catch (error) {
		console.log(`[view.tree] Error updating file ${uri.path}:`, error);
	}
}

async function removeSingleFile(uri: vscode.Uri) {
	console.log(`[view.tree] File deleted: ${uri.path}`);
	// todo,  переделать под удаление из мапы только этого класса и его свойств
	await refreshProjectData();
}

// Инициализируем сканирование
refreshProjectData();

// Следим за изменениями файлов
const fileWatcher = vscode.workspace.createFileSystemWatcher("**/*.{view.tree,ts}");
fileWatcher.onDidChange(updateSingleFile);
fileWatcher.onDidCreate(updateSingleFile);
fileWatcher.onDidDelete(removeSingleFile);
