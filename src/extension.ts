import * as vscode from "vscode";
import { SourceMapConsumer } from "source-map-js";
import { createViewCssTs, createViewTs, newModuleTs, newModuleViewTree } from "./commands";

interface ProjectData {
  components: Set<string>;
  properties: Set<string>;
  molComponents: Set<string>;
}

let projectDataPromise: Thenable<ProjectData>;

async function scanProject(): Promise<ProjectData> {
  const data: ProjectData = {
    components: new Set(),
    properties: new Set(),
    molComponents: new Set(),
  };

  console.log('[view.tree] Starting project scan...');

  // Проверяем что workspace открыт
  if (!vscode.workspace.workspaceFolders) {
    console.log('[view.tree] No workspace folders found');
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
  
  for (const file of tsFiles.slice(0, 100)) { // Ограничиваем количество для производительности
    try {
      const buffer = await vscode.workspace.fs.readFile(file);
      const content = buffer.toString();
      parseTsFile(content, data);
    } catch (error) {
      console.log(`[view.tree] Error reading ${file.path}:`, error);
    }
  }

  console.log(`[view.tree] Scan complete: ${data.components.size} components, ${data.molComponents.size} mol components, ${data.properties.size} properties`);
  console.log('[view.tree] Components found:', Array.from(data.components));
  console.log('[view.tree] Mol components found:', Array.from(data.molComponents));
  
  return data;
}

function parseViewTreeFile(content: string, data: ProjectData) {
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();

    // Ищем определения компонентов: $my_component $mol_view
    const componentMatch = trimmed.match(/^(\$\w+)\s+(\$\w+)/);
    if (componentMatch) {
      data.components.add(componentMatch[1]);
      if (componentMatch[2].startsWith("$mol_")) {
        data.molComponents.add(componentMatch[2]);
      }
    }

    // Ищем ВСЕ $mol компоненты в строке (включая в привязках)
    const molMatches = line.match(/\$mol_\w+/g);
    if (molMatches) {
      for (const match of molMatches) {
        data.molComponents.add(match);
      }
    }

    // Ищем все $-компоненты в строке  
    const allComponentMatches = line.match(/\$\w+/g);
    if (allComponentMatches) {
      for (const match of allComponentMatches) {
        if (!match.startsWith("$mol_")) {
          data.components.add(match);
        }
      }
    }

    // Ищем свойства (строки с отступом без <= и <=>)
    const indentMatch = line.match(/^(\s+)([a-zA-Z_][a-zA-Z0-9_?*]*)\s*/);
    if (indentMatch && indentMatch[1].length > 0 && !trimmed.includes("<=") && !trimmed.includes("<=>")) {
      const property = indentMatch[2];
      if (!property.startsWith("$") && property !== "null" && property !== "true" && property !== "false") {
        data.properties.add(property);
      }
    }

    // Ищем свойства в привязках: <= PropertyName
    const bindingMatch = trimmed.match(/<=\s+([a-zA-Z_][a-zA-Z0-9_?*]*)/);
    if (bindingMatch) {
      const property = bindingMatch[1];
      if (!property.startsWith("$")) {
        data.properties.add(property);
      }
    }
  }
}

function parseTsFile(content: string, data: ProjectData) {
  // Ищем $mol компоненты в TypeScript файлах
  const molMatches = content.match(/\$mol_\w+/g);
  if (molMatches) {
    for (const match of molMatches) {
      data.molComponents.add(match);
    }
  }
}

function refreshProjectData() {
  console.log('[view.tree] Refreshing project data...');
  projectDataPromise = scanProject();
}

// Инициализируем сканирование
refreshProjectData();

// Следим за изменениями файлов
const fileWatcher = vscode.workspace.createFileSystemWatcher("**/*.{view.tree,ts}");
fileWatcher.onDidChange(() => refreshProjectData());
fileWatcher.onDidCreate(() => refreshProjectData());
fileWatcher.onDidDelete(() => refreshProjectData());

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

    const viewTreeUri2 = vscode.Uri.joinPath(mamUri(), [...parts, parts.at(-1)].join("/"), parts.at(-1) + ".view.tree");
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

    return locations?.[0] ? [new vscode.Location(locations[0].targetUri, locations[0].targetSelectionRange.end)] : [];
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
    const projectData = await projectDataPromise;

    switch (completionContext.type) {
      case "component_name":
        await this.addComponentCompletions(items, projectData);
        break;
      case "component_extends":
        this.addMolComponentCompletions(items, projectData);
        break;
      case "property_name":
        this.addPropertyCompletions(items, projectData);
        break;
      case "property_binding":
        this.addBindingCompletions(items);
        break;
      case "value":
        this.addValueCompletions(items, projectData);
        break;
    }

    return items;
  }

  private getCompletionContext(document: vscode.TextDocument, position: vscode.Position, beforeCursor: string) {
    const trimmed = beforeCursor.trim();
    const indentLevel = beforeCursor.length - beforeCursor.trimStart().length;

    if (indentLevel === 0 && trimmed.startsWith("$")) {
      return { type: "component_name", indentLevel };
    }

    if (indentLevel === 0 && !trimmed.includes(" ")) {
      return { type: "component_name", indentLevel };
    }

    if (indentLevel === 0 && trimmed.includes(" ") && !trimmed.includes("$")) {
      return { type: "component_extends", indentLevel };
    }

    if (trimmed.startsWith("<=") || trimmed.includes("<=")) {
      return { type: "property_binding", indentLevel };
    }

    if (indentLevel > 0 && !trimmed.includes("<=") && !trimmed.includes("<=>")) {
      return { type: "property_name", indentLevel };
    }

    return { type: "value", indentLevel };
  }

  private async addComponentCompletions(items: vscode.CompletionItem[], projectData: ProjectData) {
    console.log(`[view.tree] Adding component completions: ${projectData.components.size} components, ${projectData.molComponents.size} mol components`);
    
    // Добавляем $mol компоненты с приоритетом
    for (const component of projectData.molComponents) {
      const item = new vscode.CompletionItem(component, vscode.CompletionItemKind.Class);
      item.detail = "$mol framework component";
      item.insertText = component;
      item.sortText = "0" + component;
      items.push(item);
    }

    // Добавляем компоненты из проекта
    for (const component of projectData.components) {
      const item = new vscode.CompletionItem(component, vscode.CompletionItemKind.Class);
      item.detail = "Project component";
      item.insertText = component;
      item.sortText = "1" + component;
      items.push(item);
    }

    // Добавляем компоненты из workspace symbols
    const symbols = (await vscode.commands.executeCommand(
      "vscode.executeWorkspaceSymbolProvider",
      "$",
    )) as vscode.SymbolInformation[];
    for (const symbol of symbols.slice(0, 30)) {
      if (symbol.name.startsWith("$") && !projectData.components.has(symbol.name) && !projectData.molComponents.has(symbol.name)) {
        const item = new vscode.CompletionItem(symbol.name, vscode.CompletionItemKind.Class);
        item.detail = symbol.containerName;
        item.insertText = symbol.name;
        item.sortText = "2" + symbol.name;
        items.push(item);
      }
    }
    
    console.log(`[view.tree] Added ${items.length} completion items`);
  }

  private addMolComponentCompletions(items: vscode.CompletionItem[], projectData: ProjectData) {
    for (const component of projectData.molComponents) {
      const item = new vscode.CompletionItem(component, vscode.CompletionItemKind.Class);
      item.detail = "$mol framework component";
      item.insertText = component;
      item.sortText = "0" + component;
      items.push(item);
    }
  }

  private addPropertyCompletions(items: vscode.CompletionItem[], projectData: ProjectData) {
    for (const property of projectData.properties) {
      const item = new vscode.CompletionItem(property, vscode.CompletionItemKind.Property);
      item.detail = "Project property";
      item.insertText = property;
      item.sortText = "1" + property;
      items.push(item);
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

  private addValueCompletions(items: vscode.CompletionItem[], projectData: ProjectData) {
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

    this.addMolComponentCompletions(items, projectData);
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
    ),
    newModuleTs,
    newModuleViewTree,
    createViewTs,
    createViewCssTs,
  );
}
