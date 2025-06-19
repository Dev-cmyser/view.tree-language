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

	if (!vscode.workspace.workspaceFolders) {
		console.log("[view.tree] No workspace folders found");
		return data;
	}

	const allFiles = await vscode.workspace.findFiles("**/*.{view.tree,ts}", "**/node_modules/**");

	for (const file of allFiles) {
		try {
			const componentsFromFile = await getComponentsFromFile(file);
			for (const [component, properties] of componentsFromFile) {
				data.componentsWithProperties.set(component, properties);
			}
		} catch (error) {
			console.log(`[view.tree] Error reading ${file.path}:`, error);
		}
	}

	console.log(`[view.tree] Scan complete: ${data.componentsWithProperties.size} components with properties`);
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
	const componentsWithProperties = new Map<string, Set<string>>();
	try {
		const buffer = await vscode.workspace.fs.readFile(uri);
		const content = buffer.toString();

		if (uri.path.endsWith(".view.tree")) {
			const result = parseViewTreeFile(content);
			for (const [component, properties] of result.componentsWithProperties) {
				componentsWithProperties.set(component, properties);
			}
		}
		if (uri.path.endsWith(".ts")) {
			const result = parseTsFile(content);
			for (const [component, properties] of result.componentsWithProperties) {
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
		// Получаем актуальные компоненты из файла
		const components = await getComponentsFromFile(uri);

		// Удаляем все компоненты которые могли быть из этого файла
		// (так как 1 файл = 1 компонент, удаляем по ключам новых компонентов)
		for (const component of components.keys()) {
			projectData.componentsWithProperties.delete(component);
		}

		// Добавляем актуальные компоненты с их свойствами
		for (const [component, properties] of components) {
			projectData.componentsWithProperties.set(component, properties);
		}
	} catch (error) {
		console.log(`[view.tree] Error updating file ${uri.path}:`, error);
	}
}

async function removeSingleFile(uri: vscode.Uri) {
	console.log(`[view.tree] File deleted: ${uri.path}`);

	// Получаем компоненты, которые были в удаленном файле
	const componentsToRemove = await getComponentsFromFile(uri);

	// Удаляем только эти компоненты из projectData
	for (const component of componentsToRemove.keys()) {
		projectData.componentsWithProperties.delete(component);
		console.log(`[view.tree] Removed component: ${component}`);
	}
}

// Инициализируем сканирование
refreshProjectData();

// Отслеживаем изменения файлов
const fileWatcher = vscode.workspace.createFileSystemWatcher("**/*.{view.tree,ts}");
fileWatcher.onDidChange(updateSingleFile);
fileWatcher.onDidCreate(updateSingleFile);
fileWatcher.onDidDelete(removeSingleFile);
