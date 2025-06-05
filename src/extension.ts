import * as vscode from "vscode";
import { SourceMapConsumer } from "source-map-js";
import { createViewCssTs, createViewTs, newModuleTs, newModuleViewTree } from "./commands";

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

  // const rightNodeChar = document.getText( new vscode.Range( wordRange.end.translate(0, 1), wordRange.end.translate(0, 2) ) )
  // if( rightNodeChar == '$' ) return 'comp'
  // const rightNodeCharAfterAsterisk = document.getText( new vscode.Range( wordRange.end.translate(0, 2), wordRange.end.translate(0, 3) ) )
  // if( rightNodeCharAfterAsterisk == '$' ) return 'comp'

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
        await this.addComponentCompletions(items);
        break;
      case "component_extends":
        await this.addMolComponentCompletions(items);
        break;
      case "property_name":
        await this.addPropertyCompletions(items);
        break;
      case "property_binding":
        this.addBindingCompletions(items);
        break;
      case "value":
        await this.addValueCompletions(items);
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

  private async addComponentCompletions(items: vscode.CompletionItem[]) {
    const symbols = (await vscode.commands.executeCommand(
      "vscode.executeWorkspaceSymbolProvider",
      "$",
    )) as vscode.SymbolInformation[];
    for (const symbol of symbols.slice(0, 30)) {
      if (symbol.name.startsWith("$")) {
        const item = new vscode.CompletionItem(symbol.name, vscode.CompletionItemKind.Class);
        item.detail = symbol.containerName;
        item.insertText = symbol.name;
        items.push(item);
      }
    }
  }

  private async addMolComponentCompletions(items: vscode.CompletionItem[]) {
    const molComponents = [
      "$mol_view",
      "$mol_page",
      "$mol_button",
      "$mol_button_major",
      "$mol_button_minor",
      "$mol_list",
      "$mol_grid",
      "$mol_deck",
      "$mol_form",
      "$mol_string",
      "$mol_number",
      "$mol_textarea",
      "$mol_select",
      "$mol_check",
      "$mol_switch",
      "$mol_calendar",
      "$mol_chat",
      "$mol_bar",
      "$mol_panel",
      "$mol_card",
      "$mol_link",
      "$mol_image",
      "$mol_icon",
      "$mol_labeler",
      "$mol_row",
      "$mol_section",
      "$mol_dimmer",
      "$mol_scroll",
      "$mol_tiler",
      "$mol_book",
      "$mol_book2",
      "$mol_book2_catalog",
    ];

    for (const component of molComponents) {
      const item = new vscode.CompletionItem(component, vscode.CompletionItemKind.Class);
      item.detail = "$mol framework component";
      item.insertText = component;
      item.sortText = "0" + component;
      items.push(item);
    }
  }

  private async addPropertyCompletions(items: vscode.CompletionItem[]) {
    const commonProps = [
      "sub",
      "title",
      "content",
      "body",
      "head",
      "foot",
      "tools",
      "minimal",
      "value?",
      "hint",
      "click?",
      "enabled",
      "visible",
      "selected?",
      "dom_name",
      "dom_class",
      "attr",
      "style",
      "field",
      "rows",
      "cols",
      "options",
      "dict",
      "uri",
      "uri_base",
      "plugins",
      "theme",
      "locale",
    ];

    for (const prop of commonProps) {
      const item = new vscode.CompletionItem(prop, vscode.CompletionItemKind.Property);
      item.detail = "view.tree property";
      item.insertText = prop;
      items.push(item);
    }

    const listItem = new vscode.CompletionItem("/", vscode.CompletionItemKind.Operator);
    listItem.detail = "Empty list";
    listItem.insertText = "/";
    items.push(listItem);

    const multiProps = ["sub*", "Row*", "Col*", "Tool*", "Option*"];
    for (const prop of multiProps) {
      const item = new vscode.CompletionItem(prop, vscode.CompletionItemKind.Property);
      item.detail = "Multi-property";
      item.insertText = prop;
      items.push(item);
    }
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

  private async addValueCompletions(items: vscode.CompletionItem[]) {
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

    await this.addMolComponentCompletions(items);
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
