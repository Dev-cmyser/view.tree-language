import * as vscode from "vscode";

interface ProjectData {
	componentsWithProperties: Map<string, Set<string>>;
}

let projectData: ProjectData = {
	componentsWithProperties: new Map(),
};

async function refreshProjectData() {
	console.log("[view.tree] Refreshing project data...");
	projectData = await scanProject();
}

async function scanProject(): Promise<ProjectData> {
	const molViewProps = new Set(["dom_name", "style", "event", "field", "attr", "sub", "title"]);
	const data: ProjectData = {
		componentsWithProperties: new Map([["$mol_view", molViewProps]]),
	};

	console.log("[view.tree] Starting project scan...");

	// Проверяем что рабочая область открыта
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
			const componentsFromFile = await getComponentsFromFile(file);
			const result = parseViewTreeFile(content);

			for (const [component, properties] of result.componentsWithProperties) {
				data.componentsWithProperties.set(component, properties);
			}
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
			const componentsFromFile = await getComponentsFromFile(file);
			const result = parseTsFile(content);
			for (const [component, properties] of result.componentsWithProperties) {
				data.componentsWithProperties.set(component, properties);
			}
		} catch (error) {
			console.log(`[view.tree] Error reading ${file.path}:`, error);
		}
	}

	console.log(`[view.tree] Scan complete: ${data.componentsWithProperties.size} components with properties`);
	console.log("[view.tree] Components props found:", Array.from(data.componentsWithProperties));

	return data;
}

function parseViewTreeFile(content: string): {
	componentsWithProperties: Map<string, Set<string>>;
} {
	const lines = content.split("\n");
	let currentComponent: string | null = null;

	// Локальные данные для возврата
	const componentsWithProperties = new Map<string, Set<string>>();

	for (const line of lines) {
		const trimmed = line.trim();

		// Берем только первое слово из строк без отступа
		if (!line.startsWith("\t") && trimmed.startsWith("$")) {
			const words = trimmed.split(/\s+/);
			const firstWord = words[0];
			currentComponent = firstWord;
			if (!componentsWithProperties.has(firstWord)) {
				componentsWithProperties.set(firstWord, new Set());
			}
		}

		// Ищем свойства компонента
		if (currentComponent) {
			// Проверяем узлы на первом уровне отступа (один таб)
			const firstLevelMatch = line.match(/^\t([a-zA-Z_][a-zA-Z0-9_?*]*)/);
			if (firstLevelMatch) {
				// Добавляем первое слово как свойство без дополнительных проверок
				const property = firstLevelMatch[1];

				// Добавляем свойство в componentsWithProperties для текущего компонента
				if (!componentsWithProperties.has(currentComponent)) {
					componentsWithProperties.set(currentComponent, new Set());
				}
				componentsWithProperties.get(currentComponent)!.add(property);
			}
		}
	}

	return { componentsWithProperties };
}

function parseTsFile(content: string): { componentsWithProperties: Map<string, Set<string>> } {
	// Ищем только первый $компонент в TypeScript файле
	const lines = content.split("\n");
	let currentClass: string | null = null;

	// Локальные данные для возврата
	const componentsWithProperties = new Map<string, Set<string>>();

	for (const line of lines) {
		// Если еще не нашли компонент, ищем объявление класса с $ компонентом
		if (!currentClass) {
			const classMatch = line.match(/export\s+class\s+(\$\w+)/);
			if (classMatch) {
				currentClass = classMatch[1];
				if (!componentsWithProperties.has(currentClass)) {
					componentsWithProperties.set(currentClass, new Set());
				}
			}
		}

		// Ищем методы с двумя табами (свойства компонента)
		if (currentClass) {
			const methodMatch = line.match(/^\t\t([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/);
			if (methodMatch) {
				const methodName = methodMatch[1];
				// Исключаем конструктор и стандартные методы
				if (methodName !== "constructor" && !methodName.startsWith("_")) {
					componentsWithProperties.get(currentClass)!.add(methodName);
				}
			}
		}
	}

	return { componentsWithProperties };
}

async function getComponentsFromFile(uri: vscode.Uri): Promise<Map<string, Set<string>>> {
	let componentsWithProperties: Map<string, Set<string>>;
	try {
		const buffer = await vscode.workspace.fs.readFile(uri);
		const content = buffer.toString();

		if (uri.path.endsWith(".view.tree")) {
			const view_tree_components = parseViewTreeFile(content);
			for (const [component, properties] of view_tree_components) {
				componentsWithProperties.set(component, properties);
			}
		} else if (uri.path.endsWith(".ts")) {
			const ts_components = parseTsFile(content);
			for (const [component, properties] of ts_components) {
				componentsWithProperties.set(component, properties);
			}
		}
	} catch (error) {
		console.log(`[view.tree] Error reading file for component extraction ${uri.path}:`, error);
	}
	return componentsWithProperties;
}

async function updateSingleFile(uri: vscode.Uri) {
	console.log(`[view.tree] Updating single file: ${uri.path}`);
	try {
		const buffer = await vscode.workspace.fs.readFile(uri);
		const content = buffer.toString();

		const components = await getComponentsFromFile(uri);
		for (const [component, properties] of components) {
			projectData.componentsWithProperties.set(component, properties);
		}
	} catch (error) {
		console.log(`[view.tree] Error updating file ${uri.path}:`, error);
	}
}

async function removeSingleFile(uri: vscode.Uri) {
	console.log(`[view.tree] File deleted: ${uri.path}`);
	// нужно удалить только 1 компонент так как 1 файл = 1 компонент
	const components = await getComponentsFromFile(uri);
	projectData.componentsWithProperties.delete(components);
	console.log(`[view.tree] Removed component: ${component}`);
}

// Инициализируем сканирование
refreshProjectData();

// Отслеживаем изменения файлов
const fileWatcher = vscode.workspace.createFileSystemWatcher("**/*.{view.tree,ts}");
fileWatcher.onDidChange(updateSingleFile);
fileWatcher.onDidCreate(updateSingleFile);
fileWatcher.onDidDelete(removeSingleFile);
