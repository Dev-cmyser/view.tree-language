import * as vscode from "vscode";
import { SourceMapConsumer } from "source-map-js";
import { createViewCssTs, createViewTs, newModuleTs, newModuleViewTree } from "./commands";

interface ProjectData {
	components: Set<string>;
	componentProperties: Map<string, Set<string>>;
	componentBaseClasses: Map<string, string>;
}

let projectData: ProjectData = {
	components: new Set(),
	componentProperties: new Map(),
	componentBaseClasses: new Map(),
};

async function scanProject(): Promise<ProjectData> {
	const molViewProps = new Set(["dom_name", "style", "event", "field", "attr", "sub", "title"]);
	const data: ProjectData = {
		components: new Set(),
		componentProperties: new Map([["$mol_view", molViewProps]]),
		componentBaseClasses: new Map(),
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
	const tsFiles = await vscode.workspace.findFiles("**/*.ts", "**/node_modules/**");
	console.log(`[view.tree] Found ${tsFiles.length} .ts files`);

	for (const file of tsFiles.slice(0, 100)) {
		// Ограничиваем количество для производительности
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
	// console.log("[view.tree] Components found:", Array.from(data.components));
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
			if (firstWord.startsWith("$")) {
				currentComponent = firstWord;
				data.components.add(firstWord);
				if (!tempProperties.has(firstWord)) {
					tempProperties.set(firstWord, new Set());
				}

				// Парсим базовый класс (второе слово, если есть)
				if (words.length > 1 && words[1].startsWith("$")) {
					data.componentBaseClasses.set(firstWord, words[1]);
				}
			}
		}

		// Ищем свойства компонента
		if (currentComponent) {
			// Проверяем узлы на первом уровне отступа (один таб)
			const firstLevelMatch = line.match(/^\t([a-zA-Z_][a-zA-Z0-9_?*]*)/);
			if (firstLevelMatch) {
				// Добавляем первое слово как свойство без дополнительных проверок
				const property = firstLevelMatch[1];
				if (!property.startsWith("$")) {
					tempProperties.get(currentComponent)!.add(property);
				}

				// Ищем свойства в правой части биндингов
				const bindingRightSideMatches = [...line.matchAll(/(?:<=|<=>|=>)\s*([a-zA-Z_][a-zA-Z0-9_?*]*)/g)];

				for (const match of bindingRightSideMatches) {
					const rightSideProperty = match[1];
					if (!rightSideProperty.startsWith("$")) {
						tempProperties.get(currentComponent)!.add(rightSideProperty);
					}
				}
			}
		}
	}

	// Обновляем основную карту свойств, сохраняя только $mol_view свойства
	const molViewProps = data.componentProperties.get("$mol_view");
	for (const [component, properties] of tempProperties) {
		data.componentProperties.set(component, properties);
	}
	if (molViewProps) {
		data.componentProperties.set("$mol_view", molViewProps);
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
}

function getComponentProperties(componentName: string, data: ProjectData, visited = new Set<string>()): Set<string> {
	if (visited.has(componentName)) {
		return new Set(); // Избегаем циклических зависимостей
	}

	visited.add(componentName);
	const properties = new Set(data.componentProperties.get(componentName) || []);

	// Добавляем свойства базового класса
	const baseClass = data.componentBaseClasses.get(componentName);
	if (baseClass && data.componentProperties.has(baseClass)) {
		const baseProperties = getComponentProperties(baseClass, data, visited);
		for (const prop of baseProperties) {
			properties.add(prop);
		}
	}

	return properties;
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
	// При удалении файла делаем полный пересканирование
	// так как сложно удалить только его данные
	await refreshProjectData();
}

// Инициализируем сканирование
refreshProjectData();

// Следим за изменениями файлов
const fileWatcher = vscode.workspace.createFileSystemWatcher("**/*.{view.tree,ts}");
fileWatcher.onDidChange(updateSingleFile);
fileWatcher.onDidCreate(updateSingleFile);
fileWatcher.onDidDelete(removeSingleFile);

const locationsForNode = {
	root_class: async function (document: vscode.TextDocument, wordRange: vscode.Range) {
		const viewTsUri = vscode.Uri.file(document.uri.path.replace(/.tree$/, ".ts"));
		const nodeName = document.getText(wordRange);
		const classSymbol = await findClassSymbol(viewTsUri, "$" + nodeName);
		if (classSymbol) return [new vscode.Location(viewTsUri, classSymbol.range)];

		const locationRange = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0));
		return [new vscode.Location(viewTsUri, locationRange)];
	},

	class: async function (document: vscode.TextDocument, wordRange: vscode.Range) {
		const nodeName = document.getText(wordRange);
		const parts = nodeName.split("_");

		const firstCharRange = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0));

		const viewTreeUri = vscode.Uri.joinPath(mamUri(), parts.join("/"), parts.at(-1) + ".view.tree");
		if (await fileExist(viewTreeUri)) {
			return [new vscode.Location(viewTreeUri, firstCharRange)];
		}

		const viewTreeUri2 = vscode.Uri.joinPath(
			mamUri(),
			[...parts, parts.at(-1)].join("/"),
			parts.at(-1) + ".view.tree",
		);
		if (await fileExist(viewTreeUri2)) {
			return [new vscode.Location(viewTreeUri2, firstCharRange)];
		}

		const symbols = (await vscode.commands.executeCommand(
			"vscode.executeWorkspaceSymbolProvider",
			"$" + nodeName,
		)) as vscode.SymbolInformation[];
		if (symbols[0]) return [symbols[0].location];

		return [new vscode.Location(viewTreeUri, firstCharRange)];
	},

	comp: async function (document: vscode.TextDocument, wordRange: vscode.Range) {
		const cssTsUri = vscode.Uri.file(document.uri.path.replace(/.tree$/, ".css.ts"));
		const symbols: vscode.DocumentSymbol[] = await vscode.commands.executeCommand(
			"vscode.executeDocumentSymbolProvider",
			cssTsUri,
		);

		const nodeName = document.getText(wordRange);
		const symb = symbols?.[0]?.children.find((symb) => symb.name == nodeName);
		if (!symb) return [];

		const locations: any[] = await vscode.commands.executeCommand(
			"vscode.executeDefinitionProvider",
			cssTsUri,
			symb.selectionRange.start,
		);
		return locations.map((l) => new vscode.Location(l.targetUri, l.targetRange));
	},

	prop: async function (document: vscode.TextDocument, wordRange: vscode.Range) {
		const className = "$" + document.getText(document.getWordRangeAtPosition(new vscode.Position(0, 1)));

		const viewTsUri = vscode.Uri.file(document.uri.path.replace(/.tree$/, ".ts"));
		const nodeName = document.getText(wordRange);
		const propSymbol = await findPropSymbol(viewTsUri, className, nodeName);

		if (!propSymbol) return locationsForNode["comp"](document, wordRange);

		const locations: any[] = await vscode.commands.executeCommand(
			"vscode.executeDefinitionProvider",
			viewTsUri,
			propSymbol.selectionRange.start,
		);
		return locations.map((l) => new vscode.Location(l.targetUri, l.targetRange));
	},

	sub_prop: async function (document: vscode.TextDocument, wordRange: vscode.Range) {
		const sourceMapUri = vscode.Uri.file(document.uri.path.replace(/([^\/]*$)/, "-view.tree/$1.d.ts.map"));
		const sourceMap = await vscode.workspace.openTextDocument(sourceMapUri);

		const consumer = new SourceMapConsumer(JSON.parse(sourceMap.getText()));

		const genPos = consumer.generatedPositionFor({
			source: (consumer as any).sources[0],
			line: wordRange.start.line + 1,
			column: wordRange.start.character + 1,
		});

		const dts = vscode.Uri.file(document.uri.path.replace(/([^\/]*$)/, "-view.tree/$1.d.ts"));
		const dtsDoc = await vscode.workspace.openTextDocument(dts);
		const symbolPos = dtsDoc.lineAt(Number(genPos.line) + 2).range.end.translate(0, -5);

		const locations: any = await vscode.commands.executeCommand("vscode.executeDefinitionProvider", dts, symbolPos);

		return locations?.[0]
			? [new vscode.Location(locations[0].targetUri, locations[0].targetSelectionRange.end)]
			: [];
	},
};

function mamUri() {
	return vscode.workspace.workspaceFolders![0].uri;
}

function getNodeType(document: vscode.TextDocument, wordRange: vscode.Range) {
	if (wordRange.start.character == 1 && wordRange.start.line == 0) return "root_class";

	const firstChar = document.getText(new vscode.Range(wordRange.start.translate(0, -1), wordRange.start));
	if (firstChar == "$") return "class";

	if (wordRange.start.character == 1) return "prop";
	const leftNodeChar = document.getText(
		new vscode.Range(wordRange.start.translate(0, -2), wordRange.start.translate(0, -1)),
	);
	if ([">", "=", "^"].includes(leftNodeChar)) return "prop";

	return "sub_prop";
}

async function findClassSymbol(tsUri: vscode.Uri, className: string) {
	if (!(await fileExist(tsUri))) return;
	const symbols = (await vscode.commands.executeCommand(
		"vscode.executeDocumentSymbolProvider",
		tsUri,
	)) as vscode.DocumentSymbol[];
	const classSymbol = symbols?.[0].children.find((symb) => symb.name == className);
	return classSymbol;
}

async function findPropSymbol(tsUri: vscode.Uri, className: string, propName: string) {
	const classSymbol = await findClassSymbol(tsUri, className);
	const propSymbol = classSymbol?.children.find((symb) => symb.name == propName);
	return propSymbol;
}

async function fileExist(uri: vscode.Uri) {
	try {
		await vscode.workspace.fs.stat(uri);
		return true;
	} catch {
		return false;
	}
}

class Provider implements vscode.DefinitionProvider {
	async provideDefinition(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken,
	): Promise<vscode.Location[]> {
		const range = document.getWordRangeAtPosition(position);
		if (!range) return [];

		const nodeName = document.getText(range);
		if (!nodeName) return [];

		const nodeType = getNodeType(document, range);
		return locationsForNode[nodeType](document, range) ?? [];
	}
}

class CompletionProvider implements vscode.CompletionItemProvider {
	async provideCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
	): Promise<vscode.CompletionItem[]> {
		const line = document.lineAt(position);
		const lineText = line.text;
		const beforeCursor = lineText.substring(0, position.character);

		const items: vscode.CompletionItem[] = [];
		const completionContext = this.getCompletionContext(document, position, beforeCursor);

		switch (completionContext.type) {
			case "component_name":
				await this.addComponentCompletions(items, projectData, document, position);
				break;
			case "component_extends":
				await this.addComponentCompletions(items, projectData, document, position);
				break;
			case "property_name":
				this.addPropertyCompletions(items, projectData, completionContext.currentComponent || null);
				break;
			case "property_binding":
				this.addBindingCompletions(items);
				break;
			case "value":
				this.addValueCompletions(items, projectData, document, position);
				break;
		}

		return items;
	}

	private getCompletionContext(document: vscode.TextDocument, position: vscode.Position, beforeCursor: string) {
		const trimmed = beforeCursor.trim();
		const indentLevel = beforeCursor.length - beforeCursor.replace(/^\t*/, "").length;

		// Если начинаем с $ в любом месте - это компонент
		if (trimmed.startsWith("$")) {
			return { type: "component_name", indentLevel, currentComponent: null };
		}

		// Если на нулевом уровне и нет пробела - это компонент
		if (indentLevel === 0 && !trimmed.includes(" ")) {
			return { type: "component_name", indentLevel, currentComponent: null };
		}

		// Если на нулевом уровне и есть пробел - это наследование
		if (indentLevel === 0 && trimmed.includes(" ")) {
			return { type: "component_extends", indentLevel, currentComponent: null };
		}

		// Если есть операторы привязки
		if (trimmed.includes("<=")) {
			return { type: "property_binding", indentLevel, currentComponent: null };
		}

		// Если с отступом - это свойство
		if (indentLevel > 0) {
			const currentComponent = this.getCurrentComponent(document, position);
			return { type: "property_name", indentLevel, currentComponent };
		}

		return { type: "value", indentLevel, currentComponent: null };
	}

	private getCurrentComponent(document: vscode.TextDocument, position: vscode.Position): string | null {
		// Ищем компонент, к которому относится текущая позиция
		for (let i = position.line; i >= 0; i--) {
			const line = document.lineAt(i);
			const text = line.text;

			// Если строка без отступа и начинается с $
			if (!text.startsWith("\t") && text.trim().startsWith("$")) {
				const firstWord = text.trim().split(/\s+/)[0];
				if (firstWord.startsWith("$")) {
					return firstWord;
				}
			}
		}
		return null;
	}

	private async addComponentCompletions(
		items: vscode.CompletionItem[],
		projectData: ProjectData,
		document: vscode.TextDocument,
		position: vscode.Position,
	) {
		console.log(`[view.tree] Adding component completions: ${projectData.components.size} components`);

		// Найти начало компонента для правильной замены
		const lineText = document.lineAt(position).text;
		let start = position.character;
		while (start > 0 && /[\w$]/.test(lineText[start - 1])) {
			start--;
		}
		const range = new vscode.Range(position.line, start, position.line, position.character);

		// Добавляем компоненты из проекта
		for (const component of projectData.components) {
			const item = new vscode.CompletionItem(component, vscode.CompletionItemKind.Class);
			item.textEdit = new vscode.TextEdit(range, component);
			item.sortText = "1" + component;
			items.push(item);
		}

		// Добавляем компоненты из workspace symbols
		const symbols = (await vscode.commands.executeCommand(
			"vscode.executeWorkspaceSymbolProvider",
			"$",
		)) as vscode.SymbolInformation[];
		for (const symbol of symbols.slice(0, 30)) {
			if (symbol.name.startsWith("$") && !projectData.components.has(symbol.name)) {
				const item = new vscode.CompletionItem(symbol.name, vscode.CompletionItemKind.Class);
				item.detail = symbol.containerName;
				item.textEdit = new vscode.TextEdit(range, symbol.name);
				item.sortText = "2" + symbol.name;
				items.push(item);
			}
		}

		console.log(`[view.tree] Added ${items.length} completion items`);
	}

	private addPropertyCompletions(
		items: vscode.CompletionItem[],
		projectData: ProjectData,
		currentComponent: string | null,
	) {
		// Добавляем свойства текущего компонента с учетом наследования
		if (currentComponent) {
			const properties = getComponentProperties(currentComponent, projectData);
			for (const property of properties) {
				const item = new vscode.CompletionItem(property, vscode.CompletionItemKind.Property);
				item.detail = `Property of ${currentComponent}`;
				item.insertText = property;
				item.sortText = "1" + property;
				items.push(item);
			}
		}

		// Добавляем общие свойства если компонент не найден
		if (!currentComponent) {
			const allProperties = new Set<string>();
			for (const component of projectData.components) {
				const properties = getComponentProperties(component, projectData);
				for (const property of properties) {
					allProperties.add(property);
				}
			}
			for (const property of allProperties) {
				const item = new vscode.CompletionItem(property, vscode.CompletionItemKind.Property);
				item.detail = "Property";
				item.insertText = property;
				item.sortText = "2" + property;
				items.push(item);
			}
		}

		const listItem = new vscode.CompletionItem("/", vscode.CompletionItemKind.Operator);
		listItem.detail = "Empty list";
		listItem.insertText = "/";
		listItem.sortText = "0/";
		items.push(listItem);
	}

	private addBindingCompletions(items: vscode.CompletionItem[]) {
		const operators = [
			{ text: "<=", detail: "One-way binding" },
			{ text: "<=>", detail: "Two-way binding" },
			{ text: "^", detail: "Override" },
			{ text: "*", detail: "Multi-property marker" },
		];

		for (const op of operators) {
			const item = new vscode.CompletionItem(op.text, vscode.CompletionItemKind.Operator);
			item.detail = op.detail;
			item.insertText = op.text;
			items.push(item);
		}
	}

	private addValueCompletions(
		items: vscode.CompletionItem[],
		projectData: ProjectData,
		document: vscode.TextDocument,
		position: vscode.Position,
	) {
		const specialValues = [
			{ text: "null", detail: "Null value" },
			{ text: "true", detail: "Boolean true" },
			{ text: "false", detail: "Boolean false" },
			{ text: "\\", detail: "String literal", insertText: "\\\n\t\\" },
			{ text: "@\\", detail: "Localized string", insertText: "@\\\n\t\\" },
			{ text: "*", detail: "Dictionary marker" },
		];

		for (const value of specialValues) {
			const item = new vscode.CompletionItem(value.text, vscode.CompletionItemKind.Value);
			item.detail = value.detail;
			item.insertText = value.insertText || value.text;
			items.push(item);
		}

		this.addComponentCompletions(items, projectData, document, position);
	}
}

const provider = new Provider();
const completionProvider = new CompletionProvider();

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.languages.registerDefinitionProvider({ language: "tree", pattern: "**/*.view.tree" }, provider),
		vscode.languages.registerCompletionItemProvider(
			{ language: "tree", pattern: "**/*.view.tree" },
			completionProvider,
			"$",
			"_",
			" ",
			"\t",
		),
		newModuleTs,
		newModuleViewTree,
		createViewTs,
		createViewCssTs,
	);
}
