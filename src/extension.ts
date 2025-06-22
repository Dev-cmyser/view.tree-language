import * as vscode from "vscode";
import { DefinitionProvider } from "./definition-provider";
import { CompletionProvider } from "./completion-provider";
import { DiagnosticProvider } from "./diagnostic-provider";
import { RenameProvider } from "./rename-provider";
import { PreviewProvider } from "./preview-provider";
import { HoverProvider } from "./hover-provider";

interface ProjectData {
	componentsWithProperties: Map<string, { properties: Set<string>; file: string }>;
}

let projectData: ProjectData = {
	componentsWithProperties: new Map(),
};

let diagnosticProvider: DiagnosticProvider;

async function refreshProjectData() {
	console.log("[view.tree] Refreshing project data...");
	projectData = await scanProject();
}

async function scanProject(): Promise<ProjectData> {
	const data: ProjectData = {
		componentsWithProperties: new Map(),
	};

	console.log("[view.tree] Starting project scan...");

	if (!vscode.workspace.workspaceFolders) {
		console.log("[view.tree] No workspace folders found");
		return data;
	}

	const tsFiles = await vscode.workspace.findFiles("**/*.ts", "**/node_modules/**");
	const viewTreeFiles = await vscode.workspace.findFiles("**/*.view.tree", "**/node_modules/**");

	for (const file of tsFiles) {
		if (file.path.endsWith(".d.ts")) {
			continue;
		}
		const componentsFromFile = await getComponentsFromFile(file);
		for (const [component, properties] of componentsFromFile) {
			data.componentsWithProperties.set(component, { properties, file: file.path });
		}
	}
	for (const file of viewTreeFiles) {
		const componentsFromFile = await getComponentsFromFile(file);
		for (const [component, properties] of componentsFromFile) {
			data.componentsWithProperties.set(component, { properties, file: file.path });
		}
	}

	console.log(`[view.tree] Scan complete: ${data.componentsWithProperties.size} components with properties`);
	return data;
}

function parseViewTreeFile(content: string): { componentsWithProperties: Map<string, Set<string>> } {
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
			// Проверяем узлы ТОЛЬКО с одним табом и БЕЗ биндингов и других символов
			const firstLevelMatch = line.match(/^\t([a-zA-Z_][a-zA-Z0-9_?*]*)\s*$/);
			if (firstLevelMatch) {
				// Исключаем строки с биндингами <=, <=>, =>, слэшами и другими символами
				if (line.includes("<=") || line.includes("=>") || line.includes("/") || line.includes("\\")) {
					continue;
				}

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
	// Получаем актуальные компоненты из файла
	const components = await getComponentsFromFile(uri);
	console.log(`[view.tree] New components  ${components} aaaa:`);

	// Удаляем все компоненты которые могли быть из этого файла
	// (так как 1 файл = 1 компонент, удаляем по ключам новых компонентов)
	for (const component of components.keys()) {
		projectData.componentsWithProperties.delete(component);
	}

	// Добавляем актуальные компоненты с их свойствами
	for (const [component, properties] of components) {
		projectData.componentsWithProperties.set(component, { properties, file: uri.path });
		console.log(`[view.tree] New components  ${components} \n ${properties}:`);
	}

	// Обновляем диагностику для .view.tree файлов
	if (uri.path.endsWith(".view.tree") && diagnosticProvider) {
		const document = await vscode.workspace.openTextDocument(uri);
		diagnosticProvider.validateDocument(document);
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

export function activate(context: vscode.ExtensionContext) {
	// Инициализируем сканирование
	refreshProjectData();

	// Создаем экземпляры провайдеров
	const definitionProvider = new DefinitionProvider(() => projectData);
	const completionProvider = new CompletionProvider(() => projectData);
	diagnosticProvider = new DiagnosticProvider(() => projectData);
	const renameProvider = new RenameProvider(() => projectData, refreshProjectData);
	const hoverProvider = new HoverProvider(() => projectData);
	const previewProvider = new PreviewProvider(context.extensionUri, () => projectData);

	// Регистрируем провайдеры для .view.tree файлов
	const treeSelector = { scheme: "file", language: "tree" };

	context.subscriptions.push(
		// Definition Provider (Go to Definition)
		vscode.languages.registerDefinitionProvider(treeSelector, definitionProvider),

		// Completion Provider (IntelliSense)
		vscode.languages.registerCompletionItemProvider(
			treeSelector,
			completionProvider,
			"$", // Trigger completion when typing $
			"\t", // Trigger completion when indenting
		),

		// Rename Provider
		vscode.languages.registerRenameProvider(treeSelector, renameProvider),

		// Hover Provider
		vscode.languages.registerHoverProvider(treeSelector, hoverProvider),

		// Preview Provider (WebView)
		vscode.window.registerWebviewViewProvider(PreviewProvider.viewType, previewProvider),

		// Diagnostic Provider
		diagnosticProvider,
	);

	// Отслеживаем изменения файлов
	const fileWatcher = vscode.workspace.createFileSystemWatcher("**/*.{view.tree,ts}");
	context.subscriptions.push(
		fileWatcher,
		fileWatcher.onDidChange(updateSingleFile),
		fileWatcher.onDidCreate(updateSingleFile),
		fileWatcher.onDidDelete(removeSingleFile),
	);

	// Валидируем все открытые .view.tree файлы при активации
	vscode.workspace.textDocuments
		.filter((doc) => doc.fileName.endsWith(".view.tree"))
		.forEach((doc) => diagnosticProvider.validateDocument(doc));

	// Слушаем изменения в документах для диагностики
	context.subscriptions.push(
		vscode.workspace.onDidChangeTextDocument((e) => {
			if (e.document.fileName.endsWith(".view.tree")) {
				diagnosticProvider.validateDocument(e.document);
			}
		}),

		vscode.workspace.onDidOpenTextDocument((doc) => {
			if (doc.fileName.endsWith(".view.tree")) {
				diagnosticProvider.validateDocument(doc);
			}
		}),

		vscode.workspace.onDidCloseTextDocument((doc) => {
			if (doc.fileName.endsWith(".view.tree")) {
				diagnosticProvider.clearDiagnostics(doc);
			}
		}),
	);

	console.log("[view.tree] Extension activated with all providers");
}

export function deactivate() {
	if (diagnosticProvider) {
		diagnosticProvider.dispose();
	}
	console.log("[view.tree] Extension deactivated");
}
