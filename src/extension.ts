import * as vscode from 'vscode';
import $, { $mol_tree2 } from 'mol_tree2';

let langsPromise: Thenable<$.$mol_tree2>

async function refresh() {
	langsPromise = vscode.workspace.findFiles( '**/*.lang.tree' ).then( async files => {
		
		const langs = [] as $.$mol_tree2[]
		
		for( const file of files ) {
			const buffer = await vscode.workspace.fs.readFile( file )
			const tree = $.$mol_tree2_from_string( buffer.toString(), file.toString() )
			langs.push( ... tree.kids )
		}
		
		return $.$mol_tree2.list( langs )
	} )
}
refresh()

const langWatcher = vscode.workspace.createFileSystemWatcher( '**/*.lang.tree' )
langWatcher.onDidChange( async uri => {
	refresh()
	provider.emit()
	return { dispose() {} }
} )

const legend = new vscode.SemanticTokensLegend([
	'comment', 'string', 'keyword', 'number', 'regexp', 'operator', 'namespace',
	'type', 'struct', 'class', 'interface', 'enum', 'typeParameter', 'function',
	'method', 'macro', 'variable', 'parameter', 'property', 'label', 'invalid'
],[])

const files = new WeakMap< vscode.TextDocument, $mol_tree2 >()

class DocumentSemanticTokensProvider implements
	vscode.DocumentSemanticTokensProvider,
	vscode.HoverProvider,
	vscode.CompletionItemProvider
{
	
	handlers = new Set<()=>void>()
	
	emit() {
		for( const handler of this.handlers ) handler()
	}
	
	onDidChangeSemanticTokens( handler: any ) {
		this.handlers.add( handler )
		return { dispose: ()=> this.handlers.delete( handler ) }
	}
	
	async provideDocumentSemanticTokens(
		document: vscode.TextDocument,
		token: vscode.CancellationToken,
	): Promise<vscode.SemanticTokens> {
		
		const builder = new vscode.SemanticTokensBuilder( legend )
		const lang = await getLang( document )
		if( token.isCancellationRequested ) return builder.build()
		
		const tree = $.$mol_ambient({
			$mol_fail: ( error: $.$mol_error_syntax ) => {
				builder.push(
					new vscode.Range(
						new vscode.Position(error.span.row-1, error.span.col-1),
						new vscode.Position(error.span.row-1, error.span.after().col-1),
					),
					'invalid',
					[],
				)
				return null as never
			},
		}).$mol_tree2_from_string( document.getText(), document.fileName )
		files.set( document, tree )
		
		const visit = ( node: $.$mol_tree2, override = '' )=> {
			
			let kind = override
				
			if( !override ) {
				
				let descr = lang?.select( '[]', node.type, null ).kids[0]
				
				lookup: if( !descr ) {
					const prefixes = lang?.select( '[:', null ).kids ?? []
					for( const prefix of prefixes ) {
						if( node.type.slice( 0, prefix.type.length ) === prefix.type ) {
							descr = prefix.kids[0]
							break lookup
						}
					}
				}
				
				kind = descr?.type ?? ( lang ? 'invalid' : classify( node.type ) )
				
				if( kind === 'comment' ) override = kind
			}
			
			builder.push(
				new vscode.Range(
					new vscode.Position(node.span.row-1, node.span.col-1),
					new vscode.Position(node.span.row-1, node.span.after().col-1),
				),
				kind,
				[],
			)
				
			for( let kid of node.kids ) visit( kid, override )
		}
		
		for( const kid of tree.kids ) visit( kid )
		
		return builder.build()
	}

	async provideHover(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken,
	) {
		
		const tree = files.get(document)
		if( !tree ) return { contents: [] }
		
		const node = find( tree, position.line + 1, position.character + 1 )
		if( !node ) return { contents: [] }
		
		const lang = await getLang( document )
		if( !lang ) return { contents: [] }
		
		let exact = lang.select( '[]', node.type, null, null ).kids[0]
		if( exact ) return { contents: [ exact.text() ] }
		
		let prefixes = lang.select( '[:', null ).kids
		for( const prefix of prefixes ) {
			if( !node.type.startsWith( prefix.type ) ) continue
			return { contents: [ prefix.kids[0]?.text() ?? '' ] }
		}
		
		return { contents: [] }
		
	}
	
	async provideCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken
	) {
		
		const lang = await getLang( document )
		if( !lang ) return []
		
		const exists = new Set< string >()
		const langItems = [] as vscode.CompletionItem[]
		
		for( const kid of lang.select( '[]', null ).kids ) {
			exists.add( kid.type )
			const item = new vscode.CompletionItem(
				kid.type,
				vscode.CompletionItemKind.Unit,
			)
			item.sortText = '1. ' + kid.type
			item.detail = kid.kids[0]?.text() ?? ''
			langItems.push( item )
		}
		
		for( const kid of lang.select( '[:', null ).kids ) {
			exists.add( kid.type )
			const item = new vscode.CompletionItem(
				kid.type,
				vscode.CompletionItemKind.Variable,
			)
			item.sortText = '2. ' + kid.type
			item.detail = kid.kids[0]?.text() ?? ''
			langItems.push( item )
		}
		
		const fileTree = files.get( document )
		if( fileTree ) {
			const names = new Set< string >()
			const visit = ( tree: $mol_tree2 )=> {
				if( tree.type && !exists.has( tree.type ) ) names.add( tree.type )
				for( const kid of tree.kids ) visit( kid )
			}
			visit( fileTree )
			for( const name of names ) {
				const item = new vscode.CompletionItem(
					name,
					vscode.CompletionItemKind.Text,
				)
				item.sortText = '3. ' + name
				item.detail = 'This file token'
				langItems.push( item )
			}
		}
		
		return new vscode.CompletionList( langItems )
		
	}
	
	async provideImplementation(
		document: vscode.TextDocument, 
		position: vscode.Position, 
		token: vscode.CancellationToken,
	) {
		const tree = files.get(document)
		if( !tree ) return []
		
		const node = find( tree, position.line + 1, position.character + 1 )
		if( !node ) return []
		
		const tsUri = vscode.Uri.file( document.uri.path.replace(/\.[^.]*$/, '.ts') )
		const symbols = await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', tsUri) as vscode.DocumentSymbol[]
		
		const classSymbol = symbols?.[0]?.children.find( symb => symb.name == tree.kids[0].type )
		const propSymbol = classSymbol?.children.find( symb => symb.name == node.type.replace(/[\*\?]+/,'') )
		if (! propSymbol ) return []
		
		const res: any[] = await vscode.commands.executeCommand('vscode.executeImplementationProvider', tsUri, propSymbol.selectionRange.start)
		return res
	}
	
	async provideDefinition(
		document: vscode.TextDocument, 
		position: vscode.Position, 
		token: vscode.CancellationToken,
	): Promise<vscode.Location[]> {
		const tree = files.get(document)
		if( !tree ) return []
		
		const findRes = findWithParent( tree, tree.kids[0], position.line + 1, position.character + 1 )
		if( !findRes ) return []
		
		const { parent, node } = findRes
		if ( !['<=','<=>','=>'].includes( parent.type ) && node.span.col != 2 && node.type.indexOf('$') == -1 ) return []
		
		const dollar_pos = node.type.indexOf('$')
		if( dollar_pos != -1 ) {
			const parts = node.type.slice( dollar_pos + 1 ).split( '_' )
			
			const mam_uri = vscode.workspace.workspaceFolders![ 0 ].uri
			const view_tree_uri = vscode.Uri.joinPath( mam_uri, parts.join( '/' ), parts.at(-1)!+ '.view.tree' )
			
			const range = new vscode.Range( new vscode.Position(0, 0), new vscode.Position(0, 0) )
			return [ new vscode.Location( view_tree_uri, range ) ]
		}
		
		const findPropSymbol = async (tsUri: vscode.Uri)=> {
			const symbols = await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', tsUri) as vscode.DocumentSymbol[]
			const classSymbol = symbols[0].children.find( symb => symb.name == tree.kids[0].type )
			const propSymbol = classSymbol?.children.find( symb => symb.name == node.type.replace(/[\*\?]+/,'') )
			return propSymbol
		}
		
		let tsUri = vscode.Uri.file( document.uri.path.replace(/\.[^.]*$/, '.ts') )
		let propSymbol = await findPropSymbol( tsUri )
		
		if( !propSymbol ) {
			tsUri = vscode.Uri.file( document.uri.path.replace(/([^\/]*$)/, '-view.tree/$1.ts') )
			propSymbol = await findPropSymbol( tsUri )
		}
		
		if( !propSymbol ) return []
		
		const locations: any[] = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', tsUri, propSymbol.selectionRange.start)
		return locations.map( l=> new vscode.Location( l.targetUri, l.targetRange ) )
	}
	
}

const getLang = async( document: vscode.TextDocument )=> {
	const langs = await langsPromise
	const langName = document.fileName.replace( /^.*\//, '' ).replace( /\.tree$/, '' ).replace( /^.*\./, '' )
	return langs.select( langName, 'kind' ).kids[0]
}

const find = ( tree: $mol_tree2, row: number, col: number ): $mol_tree2 | null => {
	if( row < tree.span.row ) return null
	if( row > tree.span.row ) return tree.kids.reduce(
		( res, kid )=> ( res || find( kid, row, col ) ),
		null as $mol_tree2 | null,
	)
	if( col < tree.span.col ) return null
	return tree.kids.reduce(
		( res, kid )=> ( res || find( kid, row, col ) ),
		null as $mol_tree2 | null,
	) ?? ( col > tree.span.col + tree.span.length ? null : tree )
}

const findWithParent = ( parent: $mol_tree2, tree: $mol_tree2, row: number, col: number ): { parent: $mol_tree2, node: $mol_tree2 } | null => {
	if( tree.span.row > row ) return null
	if( row == tree.span.row && tree.span.col + tree.span.length >= col ) {
		return { parent: parent, node: tree }
	}
	for (const kid of tree.kids) {
		const next = findWithParent( tree, kid, row, col )
		if ( next ) return next
	}
	return null
}

const provider = new DocumentSemanticTokensProvider()

// export function initialize() {
// 	return {
// 		"capabilities" : {
// 			"completionProvider" : {
// 				"resolveProvider": "false",
// 				"triggerCharacters": [ " ", "\t" ],
// 			},
// 		},	
// 	}
// }

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.languages.registerDocumentSemanticTokensProvider('view.tree', provider, legend),
		vscode.languages.registerHoverProvider('view.tree',  provider ),
		vscode.languages.registerDefinitionProvider('view.tree',  provider ),
		vscode.languages.registerImplementationProvider('view.tree',  provider ),
		vscode.languages.registerCompletionItemProvider('view.tree',  provider, " " ),
	)
}

function classify( type: string ) {
	if( !type ) return 'string'
	if( /^[-`~!@#$%\^&*()_=+|\/?"';:{}\[\]<>,.]+(?![^ \t\n\\])$/.test( type ) ) return 'operator'
	if( /^[`~!@#$%\^&*()_=+|\/?"';:{}\[\]<>,.][^ \t\n\\]+$/.test( type ) ) return 'keyword'
	return 'struct'
}
