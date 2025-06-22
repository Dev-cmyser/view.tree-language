import * as vscode from "vscode";

export class HoverProvider implements vscode.HoverProvider {
	constructor(
		private getProjectData: () => {
			componentsWithProperties: Map<string, { properties: Set<string>; file: string }>;
		},
	) {}

	async provideHover(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken,
	): Promise<vscode.Hover | undefined> {
		// Используем встроенный API для поиска слова с кастомным регексом
		const wordRange = document.getWordRangeAtPosition(position, /\$?\w+/);
		if (!wordRange) return undefined;

		const word = document.getText(wordRange);

		// Если это $компонент
		if (word.startsWith("$")) {
			return this.getComponentHover(word, wordRange);
		}

		// Если это свойство компонента
		if (document.fileName.endsWith('.view.tree')) {
			const currentComponent = this.getCurrentComponent(document, position);
			if (currentComponent) {
				return this.getPropertyHover(word, currentComponent, wordRange);
			}
		}

		return undefined;
	}

	private getComponentHover(componentName: string, range: vscode.Range): vscode.Hover | undefined {
		const projectData = this.getProjectData();
		const componentData = projectData.componentsWithProperties.get(componentName);

		if (componentData) {
			const markdown = new vscode.MarkdownString();
			markdown.isTrusted = true;
			
			// Заголовок компонента
			markdown.appendMarkdown(`## ${componentName}\n\n`);
			
			// Путь к файлу
			const fileName = componentData.file.split('/').pop() || componentData.file;
			markdown.appendMarkdown(`**File:** \`${fileName}\`\n\n`);
			
			// Свойства компонента
			if (componentData.properties.size > 0) {
				markdown.appendMarkdown(`**Properties:**\n`);
				const sortedProperties = Array.from(componentData.properties).sort();
				for (const property of sortedProperties) {
					const propertyType = this.getPropertyType(property);
					markdown.appendMarkdown(`- \`${property}\` ${propertyType}\n`);
				}
			} else {
				markdown.appendMarkdown(`*No properties found*\n`);
			}

			// Добавляем команду для перехода к определению
			markdown.appendMarkdown(`\n---\n`);
			markdown.appendMarkdown(`[Go to definition](command:vscode.executeDefinitionProvider?${encodeURIComponent(JSON.stringify([componentData.file, range.start]))})\n`);

			return new vscode.Hover(markdown, range);
		}

		// Проверяем базовые $mol компоненты
		const molComponentInfo = this.getMolComponentInfo(componentName);
		if (molComponentInfo) {
			const markdown = new vscode.MarkdownString();
			markdown.isTrusted = true;
			
			markdown.appendMarkdown(`## ${componentName}\n\n`);
			markdown.appendMarkdown(`**Type:** Built-in $mol component\n\n`);
			markdown.appendMarkdown(`**Description:** ${molComponentInfo.description}\n\n`);
			
			if (molComponentInfo.properties.length > 0) {
				markdown.appendMarkdown(`**Common Properties:**\n`);
				for (const property of molComponentInfo.properties) {
					markdown.appendMarkdown(`- \`${property}\`\n`);
				}
			}

			return new vscode.Hover(markdown, range);
		}

		return undefined;
	}

	private getPropertyHover(propertyName: string, componentName: string, range: vscode.Range): vscode.Hover | undefined {
		const projectData = this.getProjectData();
		const componentData = projectData.componentsWithProperties.get(componentName);

		// Проверяем, есть ли такое свойство у компонента
		if (componentData && componentData.properties.has(propertyName)) {
			const markdown = new vscode.MarkdownString();
			markdown.isTrusted = true;
			
			markdown.appendMarkdown(`## ${propertyName}\n\n`);
			markdown.appendMarkdown(`**Component:** \`${componentName}\`\n`);
			markdown.appendMarkdown(`**Type:** ${this.getPropertyType(propertyName)}\n\n`);
			
			const description = this.getPropertyDescription(propertyName, componentName);
			if (description) {
				markdown.appendMarkdown(`**Description:** ${description}\n\n`);
			}

			return new vscode.Hover(markdown, range);
		}

		// Проверяем общие свойства
		const commonPropertyInfo = this.getCommonPropertyInfo(propertyName);
		if (commonPropertyInfo) {
			const markdown = new vscode.MarkdownString();
			markdown.isTrusted = true;
			
			markdown.appendMarkdown(`## ${propertyName}\n\n`);
			markdown.appendMarkdown(`**Type:** ${commonPropertyInfo.type}\n`);
			markdown.appendMarkdown(`**Usage:** Common property\n\n`);
			markdown.appendMarkdown(`**Description:** ${commonPropertyInfo.description}\n\n`);

			if (commonPropertyInfo.example) {
				markdown.appendMarkdown(`**Example:**\n`);
				markdown.appendMarkdown(`\`\`\`tree\n${commonPropertyInfo.example}\n\`\`\`\n`);
			}

			return new vscode.Hover(markdown, range);
		}

		return undefined;
	}

	private getCurrentComponent(document: vscode.TextDocument, position: vscode.Position): string | null {
		// Ищем ближайший компонент вверх от текущей позиции
		for (let i = position.line - 1; i >= 0; i--) {
			const line = document.lineAt(i);
			const lineText = line.text.trim();
			
			// Если строка без отступов и начинается с $
			if (!line.text.startsWith('\t') && lineText.startsWith('$')) {
				const words = lineText.split(/\s+/);
				return words[0];
			}
		}
		return null;
	}

	private getPropertyType(propertyName: string): string {
		if (propertyName.endsWith('?')) {
			return '*(boolean)*';
		}
		if (propertyName.endsWith('*')) {
			return '*(array)*';
		}
		if (['width', 'height', 'size', 'count', 'max', 'min'].some(num => propertyName.includes(num))) {
			return '*(number)*';
		}
		if (['sub', 'content'].includes(propertyName)) {
			return '*(children)*';
		}
		return '*(string)*';
	}

	private getPropertyDescription(propertyName: string, componentName: string): string | undefined {
		// Базовые описания для свойств
		const descriptions: { [key: string]: string } = {
			'title': 'Display title or label text',
			'hint': 'Tooltip text shown on hover',
			'enabled?': 'Whether the component is enabled for interaction',
			'visible?': 'Whether the component is visible',
			'sub': 'Child components or content',
			'content': 'Text content or child elements',
			'dom_name': 'HTML tag name for rendering',
			'dom_tree': 'DOM structure definition',
			'uri': 'URL or resource identifier',
			'text': 'Text content to display',
			'click': 'Click event handler'
		};

		return descriptions[propertyName];
	}

	private getCommonPropertyInfo(propertyName: string): { type: string; description: string; example?: string } | undefined {
		const commonProperties: { [key: string]: { type: string; description: string; example?: string } } = {
			'title': {
				type: 'string',
				description: 'Sets the title or main text content of the component',
				example: 'title <= "Hello World"'
			},
			'hint': {
				type: 'string',
				description: 'Tooltip text that appears when hovering over the component',
				example: 'hint <= "Click to continue"'
			},
			'enabled?': {
				type: 'boolean',
				description: 'Controls whether the component accepts user interaction',
				example: 'enabled? <= true'
			},
			'visible?': {
				type: 'boolean',
				description: 'Controls whether the component is visible in the UI',
				example: 'visible? <= this.show_panel()'
			},
			'sub': {
				type: 'children',
				description: 'Container for child components',
				example: 'sub /\n\t\t<= Button title <= "Click me"'
			},
			'content': {
				type: 'children',
				description: 'Text content or list of child elements',
				example: 'content /\n\t\t<= "Some text content"'
			},
			'uri': {
				type: 'string',
				description: 'URL or resource identifier for links and navigation',
				example: 'uri <= "https://example.com"'
			},
			'click': {
				type: 'function',
				description: 'Event handler for click interactions',
				example: 'click <= () => this.handle_click()'
			}
		};

		return commonProperties[propertyName];
	}

	private getMolComponentInfo(componentName: string): { description: string; properties: string[] } | undefined {
		const molComponents: { [key: string]: { description: string; properties: string[] } } = {
			'$mol_view': {
				description: 'Base view component for creating UI elements',
				properties: ['sub', 'title', 'hint', 'enabled?', 'visible?', 'dom_name', 'dom_tree']
			},
			'$mol_button': {
				description: 'Interactive button component',
				properties: ['title', 'hint', 'enabled?', 'click', 'uri']
			},
			'$mol_link': {
				description: 'Navigation link component',
				properties: ['title', 'hint', 'uri', 'sub']
			},
			'$mol_text': {
				description: 'Text display component',
				properties: ['text', 'content']
			},
			'$mol_list': {
				description: 'List container component',
				properties: ['sub', 'content']
			},
			'$mol_page': {
				description: 'Page layout component',
				properties: ['title', 'sub', 'head', 'body', 'foot']
			},
			'$mol_form': {
				description: 'Form container component',
				properties: ['sub', 'submit', 'reset']
			},
			'$mol_card': {
				description: 'Card layout component',
				properties: ['title', 'content', 'head', 'body', 'foot']
			}
		};

		return molComponents[componentName];
	}
}
