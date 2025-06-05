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
    token: vscode.CancellationToken,
    context: vscode.CompletionContext,
  ): Promise<vscode.CompletionItem[]> {
    const range = document.getWordRangeAtPosition(position);
    const nodeType = range ? getNodeType(document, range) : "prop";

    const items: vscode.CompletionItem[] = [];

    // Базовые предложения на основе контекста
    switch (nodeType) {
      case "root_class":
      case "class":
        // Предлагаем классы из workspace
        const symbols = (await vscode.commands.executeCommand(
          "vscode.executeWorkspaceSymbolProvider",
          "$",
        )) as vscode.SymbolInformation[];
        for (const symbol of symbols.slice(0, 50)) {
          // Ограничиваем количество
          if (symbol.name.startsWith("$")) {
            const item = new vscode.CompletionItem(symbol.name.slice(1), vscode.CompletionItemKind.Class);
            item.detail = symbol.containerName;
            item.insertText = symbol.name.slice(1);
            items.push(item);
          }
        }
        break;

      case "prop":
        // Предлагаем общие свойства
        const commonProps = ["sub", "title", "content", "enabled", "visible", "dom_name", "dom_class", "attr"];
        for (const prop of commonProps) {
          const item = new vscode.CompletionItem(prop, vscode.CompletionItemKind.Property);
          item.insertText = prop;
          items.push(item);
        }
        break;
    }

    return items;
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
