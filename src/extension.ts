import * as vscode from 'vscode';

class Provider implements
	vscode.ImplementationProvider,
	vscode.DefinitionProvider
{
	async provideImplementation(
		document: vscode.TextDocument, 
		position: vscode.Position, 
		token: vscode.CancellationToken,
	) {
		const range = document.getWordRangeAtPosition( position )
		if( !range ) return []
		const nodeName = document.getText( range )
		if( !nodeName ) return []
		
		if( !isItComponentProp( document, range ) ) return []
				
		const className = '$' + document.getText( document.getWordRangeAtPosition( new vscode.Position(0, 1) ) )
		const viewTsUri = vscode.Uri.file( document.uri.path.replace(/\.[^.]*$/, '.ts') )
		let propSymbol = await findPropSymbol( viewTsUri, className, nodeName )
		
		if (! propSymbol ) return []
		
		const locations: any[] = await vscode.commands.executeCommand(
			'vscode.executeImplementationProvider', 
			viewTsUri, 
			propSymbol.selectionRange.start
		)
		return locations
	}
	
	async provideDefinition(
		document: vscode.TextDocument, 
		position: vscode.Position, 
		token: vscode.CancellationToken,
	): Promise<vscode.Location[]> {
		const range = document.getWordRangeAtPosition( position )
		if( !range ) return []
		const nodeName = document.getText( range )
		if( !nodeName ) return []
		
		let class_check_char = document.getText( new vscode.Range( range.start.translate(0, -1), range.start ) )
		if( class_check_char == '$') {
			const parts = nodeName.split( '_' )
			
			const mam_uri = vscode.workspace.workspaceFolders![ 0 ].uri
			const view_tree_uri = vscode.Uri.joinPath( mam_uri, parts.join( '/' ), parts.at(-1)!+ '.view.tree' )
			
			const range = new vscode.Range( new vscode.Position(0, 0), new vscode.Position(0, 0) )
			return [ new vscode.Location( view_tree_uri, range ) ]
		}
		
		if( !isItComponentProp( document, range ) ) return []
		
		const className = '$' + document.getText( document.getWordRangeAtPosition( new vscode.Position(0, 1) ) )
		let viewTsUri = vscode.Uri.file( document.uri.path.replace(/\.[^.]*$/, '.ts') )
		let propSymbol = await findPropSymbol( viewTsUri, className, nodeName )
		
		if( !propSymbol ) {
			viewTsUri = vscode.Uri.file( document.uri.path.replace(/([^\/]*$)/, '-view.tree/$1.ts') )
			propSymbol = await findPropSymbol( viewTsUri, className, nodeName )
		}
		
		if (! propSymbol ) return []
		
		const locations: any[] = await vscode.commands.executeCommand(
			'vscode.executeDefinitionProvider', 
			viewTsUri, 
			propSymbol.selectionRange.start
		)
		return locations.map( l=> new vscode.Location( l.targetUri, l.targetRange ) )
	}
	
}

function isItComponentProp( document: vscode.TextDocument, wordRange: vscode.Range ) {
	if( wordRange.start.character == 1 ) return true
	
	let bind_check_char = document.getText( new vscode.Range( wordRange.start.translate(0, -2), wordRange.start.translate(0, -1) ) )
	if( bind_check_char != '>' && bind_check_char != '=' ) return false
	
	return true
}

async function findPropSymbol( tsUri: vscode.Uri, className: string, propName: string ) {
	try {
		await vscode.workspace.fs.stat( tsUri )
	} catch {
		return //ts file does not exist
	}
	const symbols = await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', tsUri) as vscode.DocumentSymbol[]
	const classSymbol = symbols?.[0].children.find( symb => symb.name == className )
	const propSymbol = classSymbol?.children.find( symb => symb.name == propName )
	return propSymbol
}

const provider = new Provider()

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.languages.registerDefinitionProvider( { language: 'tree', pattern: '**/*.view.tree' }, provider ),
		vscode.languages.registerImplementationProvider( { language: 'tree', pattern: '**/*.view.tree' }, provider ),
	)
}
