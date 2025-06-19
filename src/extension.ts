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
			const result = parseViewTreeFile(content);
			// Добавляем компоненты в data
			for (const component of result.components) {
				data.components.add(component);
			}
			for (const [component, properties] of result.componentProperties) {
				data.componentProperties.set(component, properties);
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
			const result = parseTsFile(content);
			// Добавляем компоненты в data
			for (const component of result.components) {
				data.components.add(component);
			}
			for (const [component, properties] of result.componentProperties) {
				data.componentProperties.set(component, properties);
			}
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

// нужно что бы эта функция возращала компоненты с пропсами а не записывала напрямую
function parseViewTreeFile(content: string): {
	components: Set<string>;
	componentProperties: Map<string, Set<string>>;
} {
	const lines = content.split("\n");
	let currentComponent: string | null = null;

	// Локальные данные для возврата
	const components = new Set<string>();
	const componentProperties = new Map<string, Set<string>>();

	for (const line of lines) {
		const trimmed = line.trim();

		// Берем только первое слово из строк без отступа
		if (!line.startsWith("\t") && trimmed.startsWith("$")) {
			const words = trimmed.split(/\s+/);
			const firstWord = words[0];
			currentComponent = firstWord;
			components.add(firstWord);
			if (!componentProperties.has(firstWord)) {
				componentProperties.set(firstWord, new Set());
			}
		}

		// Ищем свойства компонента
		if (currentComponent) {
			// Проверяем узлы на первом уровне отступа (один таб)
			const firstLevelMatch = line.match(/^\t([a-zA-Z_][a-zA-Z0-9_?*]*)/);
			if (firstLevelMatch) {
				// Добавляем первое слово как свойство без дополнительных проверок
				const property = firstLevelMatch[1];

				// Добавляем свойство в componentProperties для текущего компонента
				if (!componentProperties.has(currentComponent)) {
					componentProperties.set(currentComponent, new Set());
				}
				componentProperties.get(currentComponent)!.add(property);

				// Также добавляем компоненты из правой части биндингов как свойства
				const bindingRightSideMatches = [...line.matchAll(/(?:<=|<=>|=>)\s*([a-zA-Z_][a-zA-Z0-9_?*]*)/g)];
				for (const match of bindingRightSideMatches) {
					const bindingComponent = match[1];
					if (bindingComponent.startsWith("$")) {
						components.add(bindingComponent);
					}
				}
			}
		}
	}

	return { components, componentProperties };
}

// нужно что бы эта функция возращала компоненты с пропсами а не записывала напрямую
function parseTsFile(content: string): { components: Set<string>; componentProperties: Map<string, Set<string>> } {
	// Ищем только первый $компонент в TypeScript файле
	const lines = content.split("\n");
	let currentClass: string | null = null;

	// Локальные данные для возврата
	const components = new Set<string>();
	const componentProperties = new Map<string, Set<string>>();

	for (const line of lines) {
		// Если еще не нашли компонент, ищем объявление класса с $ компонентом
		if (!currentClass) {
			const classMatch = line.match(/export\s+class\s+(\$\w+)/);
			if (classMatch) {
				currentClass = classMatch[1];
				components.add(currentClass);
				if (!componentProperties.has(currentClass)) {
					componentProperties.set(currentClass, new Set());
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
					componentProperties.get(currentClass)!.add(methodName);
				}
			}
		}
	}

	return { components, componentProperties };
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
			const result = parseViewTreeFile(content);
			// Добавляем компоненты в projectData
			for (const component of result.components) {
				projectData.components.add(component);
			}
			for (const [component, properties] of result.componentProperties) {
				projectData.componentProperties.set(component, properties);
			}
		} else if (uri.path.endsWith(".ts")) {
			const result = parseTsFile(content);
			// Добавляем компоненты в projectData
			for (const component of result.components) {
				projectData.components.add(component);
			}
			for (const [component, properties] of result.componentProperties) {
				projectData.componentProperties.set(component, properties);
			}
		}
	} catch (error) {
		console.log(`[view.tree] Error updating file ${uri.path}:`, error);
	}
}

async function getComponentsFromFile(uri: vscode.Uri): Promise<Set<string>> {
	const components = new Set<string>();
	try {
		const buffer = await vscode.workspace.fs.readFile(uri);
		const content = buffer.toString();

		if (uri.path.endsWith(".view.tree")) {
			const result = parseViewTreeFile(content);
			for (const component of result.components) {
				components.add(component);
			}
		} else if (uri.path.endsWith(".ts")) {
			const result = parseTsFile(content);
			for (const component of result.components) {
				components.add(component);
			}
		}
	} catch (error) {
		console.log(`[view.tree] Error reading file for component extraction ${uri.path}:`, error);
	}
	return components;
}

async function removeSingleFile(uri: vscode.Uri) {
	console.log(`[view.tree] File deleted: ${uri.path}`);

	// Получаем компоненты, которые были в удаленном файле
	const componentsToRemove = await getComponentsFromFile(uri);

	// Удаляем только эти компоненты из projectData
	for (const component of componentsToRemove) {
		projectData.components.delete(component);
		projectData.componentProperties.delete(component);
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
