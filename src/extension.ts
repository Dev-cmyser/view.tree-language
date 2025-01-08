import * as vscode from 'vscode';
import { SourceMapConsumer } from 'source-map-js'
import { createViewCssTs, createViewTs, newModuleTs, newModuleViewTree } from './commands';

class Provider implements
	vscode.DefinitionProvider
{
	
	async provideDefinition(
		document: vscode.TextDocument, 
		position: vscode.Position, 
		token: vscode.CancellationToken,
	): Promise<vscode.Location[]> {

		const range = document.getWordRangeAtPosition( position )
		if( !range ) return []

		const nodeName = document.getText( range )
		if( !nodeName ) return []

		// component class name -> go to view.ts
		if( range.start.character == 1 && range.start.line == 0 ) {

			let viewTsUri = vscode.Uri.file( document.uri.path.replace(/.tree$/, '.ts') )

			const classSymbol = await findClassSymbol( viewTsUri, '$' + nodeName )
			if( classSymbol ) return [ new vscode.Location( viewTsUri, classSymbol.range ) ]
			
			const locationRange = new vscode.Range( new vscode.Position(0, 0), new vscode.Position(0, 0) )
			return [ new vscode.Location( viewTsUri, locationRange ) ]

		}

		// subcomponent class name -> go to subcomp view.tree
		let leftChar = document.getText( new vscode.Range( range.start.translate(0, -1), range.start ) )
		if( leftChar == '$') {

			const parts = nodeName.split( '_' )

			const firstCharRange = new vscode.Range( new vscode.Position(0, 0), new vscode.Position(0, 0) )
			
			const viewTreeUri = vscode.Uri.joinPath( mamUri(), parts.join( '/' ), parts.at(-1) + '.view.tree' )
			if( await fileExist( viewTreeUri ) ) {
				return [ new vscode.Location( viewTreeUri, firstCharRange ) ]
			}
			
			const viewTreeUri2 = vscode.Uri.joinPath( mamUri(), [ ...parts, parts.at(-1) ].join( '/' ), parts.at(-1) + '.view.tree' )
			if( await fileExist( viewTreeUri2 ) ) {
				return [ new vscode.Location( viewTreeUri2, firstCharRange ) ]
			}
			
			const symbols = await vscode.commands.executeCommand('vscode.executeWorkspaceSymbolProvider', '$' + nodeName) as vscode.SymbolInformation[]
			if( symbols[0] ) return [ symbols[0].location ]
			
			return [ new vscode.Location( viewTreeUri, firstCharRange ) ]

		}
		
		// component prop -> go to view.ts
		if( isItComponentProp( document, range ) ) {

			const className = '$' + document.getText( document.getWordRangeAtPosition( new vscode.Position(0, 1) ) )

			let viewTsUri = vscode.Uri.file( document.uri.path.replace(/.tree$/, '.ts') )
			let propSymbol = await findPropSymbol( viewTsUri, className, nodeName )
			
			if( !propSymbol ) return []
			
			const locations: any[] = await vscode.commands.executeCommand(
				'vscode.executeDefinitionProvider', 
				viewTsUri, 
				propSymbol.selectionRange.start
			)
			return locations.map( l=> new vscode.Location( l.targetUri, l.targetRange ) )

		}
			
		// subcomponent prop -> go to view.tree
		const sourceMapUri = vscode.Uri.file( document.uri.path.replace(/([^\/]*$)/, '-view.tree/$1.d.ts.map') )
		const sourceMap = await vscode.workspace.openTextDocument( sourceMapUri )
		
		const consumer = new SourceMapConsumer( JSON.parse( sourceMap.getText() ) )

		const genPos = consumer.generatedPositionFor({
			source: (consumer as any).sources[ 0 ],
			line: range.start.line + 1,
			column: range.start.character + 1,
		})
		
		const dts = vscode.Uri.file( document.uri.path.replace(/([^\/]*$)/, '-view.tree/$1.d.ts') )
		const dtsDoc = await vscode.workspace.openTextDocument( dts )
		const symbolPos = dtsDoc.lineAt( Number( genPos.line ) + 2 ).range.end.translate( 0, -5 )

		const locations: any = await vscode.commands.executeCommand(
			'vscode.executeDefinitionProvider', 
			dts, 
			symbolPos,
		)
		
		return locations?.[0] ? [ new vscode.Location( locations[0].targetUri, locations[0].targetSelectionRange.end ) ] : []
	}
	
}

function mamUri() {
	return vscode.workspace.workspaceFolders![0].uri
}

function isItComponentProp( document: vscode.TextDocument, wordRange: vscode.Range ) {
	if( wordRange.start.character == 1 ) return true
	
	let leftChar = document.getText( new vscode.Range( wordRange.start.translate(0, -2), wordRange.start.translate(0, -1) ) )
	if( leftChar != '>' && leftChar != '=' && leftChar != '^' ) return false
	
	return true
}

async function findClassSymbol( tsUri: vscode.Uri, className: string ) {
	if( ! await fileExist( tsUri ) ) return
	const symbols = await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', tsUri) as vscode.DocumentSymbol[]
	const classSymbol = symbols?.[0].children.find( symb => symb.name == className )
	return classSymbol
}

async function findPropSymbol( tsUri: vscode.Uri, className: string, propName: string ) {
	const classSymbol = await findClassSymbol( tsUri, className )
	const propSymbol = classSymbol?.children.find( symb => symb.name == propName )
	return propSymbol
}

async function fileExist( uri: vscode.Uri ) {
	try {
		await vscode.workspace.fs.stat( uri )
		return true
	} catch {
		return false
	}
}

const provider = new Provider()

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.languages.registerDefinitionProvider( { language: 'tree', pattern: '**/*.view.tree' }, provider ),
		newModuleTs,
		newModuleViewTree,
		createViewTs,
		createViewCssTs,
	)
}
