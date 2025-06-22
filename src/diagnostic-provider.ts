import * as vscode from "vscode";

export class DiagnosticProvider {
	private diagnosticCollection: vscode.DiagnosticCollection;

	constructor(
		private getProjectData: () => {
			componentsWithProperties: Map<string, { properties: Set<string>; file: string }>;
		},
	) {
		this.diagnosticCollection = vscode.languages.createDiagnosticCollection("view-tree");
	}

	public validateDocument(document: vscode.TextDocument): void {
		if (!document.fileName.endsWith(".view.tree")) {
			return;
		}

		const diagnostics: vscode.Diagnostic[] = [];
		const lines = document.getText().split("\n");
		let currentComponent: string | null = null;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const trimmed = line.trim();

			// Пропускаем пустые строки и комментарии
			if (!trimmed || trimmed.startsWith("--")) {
				continue;
			}

			const indentLevel = this.getIndentLevel(line);

			// Валидация компонентов (уровень 0)
			if (indentLevel === 0) {
				currentComponent = this.validateComponent(line, i, diagnostics);
			}
			// Валидация свойств (уровень 1)
			else if (indentLevel === 1) {
				this.validateProperty(line, i, currentComponent, diagnostics);
			}
			// Валидация значений и вложенных элементов (уровень 2+)
			else if (indentLevel >= 2) {
				this.validateNestedContent(line, i, diagnostics);
			}
			// Неправильные отступы
			else {
				this.addDiagnostic(
					diagnostics,
					i,
					0,
					line.length,
					"Invalid indentation level",
					vscode.DiagnosticSeverity.Error,
				);
			}
		}

		this.diagnosticCollection.set(document.uri, diagnostics);
	}

	private validateComponent(line: string, lineNumber: number, diagnostics: vscode.Diagnostic[]): string | null {
		const trimmed = line.trim();
		const words = trimmed.split(/\s+/);
		const componentName = words[0];

		// Проверяем, что компонент начинается с $
		if (!componentName.startsWith("$")) {
			this.addDiagnostic(
				diagnostics,
				lineNumber,
				0,
				componentName.length,
				"Component name must start with '$'",
				vscode.DiagnosticSeverity.Error,
			);
			return null;
		}

		// Проверяем валидность имени компонента
		if (!/^\$[a-zA-Z_][a-zA-Z0-9_]*$/.test(componentName)) {
			this.addDiagnostic(
				diagnostics,
				lineNumber,
				0,
				componentName.length,
				"Invalid component name. Use only letters, numbers and underscores",
				vscode.DiagnosticSeverity.Error,
			);
			return null;
		}

		// Проверяем, существует ли компонент в проекте
		const projectData = this.getProjectData();
		if (!projectData.componentsWithProperties.has(componentName)) {
			// Проверяем, не является ли это базовым $mol компонентом
			const molComponents = [
				"$mol_view",
				"$mol_button",
				"$mol_link",
				"$mol_text",
				"$mol_list",
				"$mol_page",
				"$mol_form",
				"$mol_card",
			];
			if (!molComponents.includes(componentName)) {
				this.addDiagnostic(
					diagnostics,
					lineNumber,
					0,
					componentName.length,
					`Component '${componentName}' not found in project`,
					vscode.DiagnosticSeverity.Warning,
				);
			}
		}

		// Проверяем дополнительные параметры после имени компонента
		if (words.length > 1) {
			const params = words.slice(1).join(" ");
			if (!/^[a-zA-Z0-9_\s]*$/.test(params)) {
				this.addDiagnostic(
					diagnostics,
					lineNumber,
					componentName.length + 1,
					line.length,
					"Invalid component parameters",
					vscode.DiagnosticSeverity.Warning,
				);
			}
		}

		return componentName;
	}

	private validateProperty(
		line: string,
		lineNumber: number,
		currentComponent: string | null,
		diagnostics: vscode.Diagnostic[],
	): void {
		const trimmed = line.trim();

		// Пропускаем строки с биндингами
		if (trimmed.includes("<=") || trimmed.includes("=>") || trimmed.includes("<=>")) {
			this.validateBinding(line, lineNumber, diagnostics);
			return;
		}

		// Пропускаем строки со слэшами (пути)
		if (trimmed.includes("/") || trimmed.includes("\\")) {
			return;
		}

		const words = trimmed.split(/\s+/);
		const propertyName = words[0];

		// Проверяем валидность имени свойства
		if (!/^[a-zA-Z_][a-zA-Z0-9_?*]*$/.test(propertyName)) {
			this.addDiagnostic(
				diagnostics,
				lineNumber,
				this.getIndentLevel(line),
				this.getIndentLevel(line) + propertyName.length,
				"Invalid property name",
				vscode.DiagnosticSeverity.Error,
			);
			return;
		}

		// Проверяем, существует ли свойство у текущего компонента
		if (currentComponent) {
			const projectData = this.getProjectData();
			const componentData = projectData.componentsWithProperties.get(currentComponent);

			if (componentData && !componentData.properties.has(propertyName)) {
				// Проверяем общие свойства
				const commonProperties = [
					"title",
					"hint",
					"enabled?",
					"visible?",
					"sub",
					"content",
					"dom_name",
					"dom_tree",
				];
				if (!commonProperties.includes(propertyName)) {
					this.addDiagnostic(
						diagnostics,
						lineNumber,
						this.getIndentLevel(line),
						this.getIndentLevel(line) + propertyName.length,
						`Property '${propertyName}' not found in component '${currentComponent}'`,
						vscode.DiagnosticSeverity.Information,
					);
				}
			}
		}

		// Валидация значений свойств
		if (words.length > 1) {
			const value = words.slice(1).join(" ");
			this.validatePropertyValue(propertyName, value, lineNumber, line, diagnostics);
		}
	}

	private validateBinding(line: string, lineNumber: number, diagnostics: vscode.Diagnostic[]): void {
		const trimmed = line.trim();

		// Проверяем корректность биндингов
		const bindingPatterns = [
			/^[a-zA-Z_][a-zA-Z0-9_]*\s*<=\s*.+$/, // property <= source
			/^[a-zA-Z_][a-zA-Z0-9_]*\s*=>\s*.+$/, // property => target
			/^[a-zA-Z_][a-zA-Z0-9_]*\s*<=>\s*.+$/, // property <=> bidirectional
		];

		const isValidBinding = bindingPatterns.some((pattern) => pattern.test(trimmed));

		if (!isValidBinding) {
			this.addDiagnostic(
				diagnostics,
				lineNumber,
				this.getIndentLevel(line),
				line.length,
				"Invalid binding syntax",
				vscode.DiagnosticSeverity.Error,
			);
		}
	}

	private validatePropertyValue(
		propertyName: string,
		value: string,
		lineNumber: number,
		line: string,
		diagnostics: vscode.Diagnostic[],
	): void {
		// Валидация boolean значений
		if (propertyName.endsWith("?")) {
			if (!["true", "false"].includes(value.toLowerCase())) {
				const valueStart = line.indexOf(value);
				this.addDiagnostic(
					diagnostics,
					lineNumber,
					valueStart,
					valueStart + value.length,
					"Boolean property must be 'true' or 'false'",
					vscode.DiagnosticSeverity.Error,
				);
			}
		}

		// Валидация числовых значений для определенных свойств
		const numericProperties = ["width", "height", "size", "count", "max", "min"];
		if (numericProperties.some((prop) => propertyName.includes(prop))) {
			if (!/^\d+(\.\d+)?$/.test(value) && !value.startsWith("<=") && !value.startsWith("=>")) {
				const valueStart = line.indexOf(value);
				this.addDiagnostic(
					diagnostics,
					lineNumber,
					valueStart,
					valueStart + value.length,
					"Expected numeric value",
					vscode.DiagnosticSeverity.Warning,
				);
			}
		}
	}

	private validateNestedContent(line: string, lineNumber: number, diagnostics: vscode.Diagnostic[]): void {
		const trimmed = line.trim();

		// Проверяем, что вложенный контент не пустой
		if (!trimmed) {
			return;
		}

		// Если это компонент, валидируем его
		if (trimmed.startsWith("$")) {
			this.validateComponent(line, lineNumber, diagnostics);
		}
	}

	private getIndentLevel(line: string): number {
		const match = line.match(/^(\t*)/);
		return match ? match[1].length : 0;
	}

	private addDiagnostic(
		diagnostics: vscode.Diagnostic[],
		line: number,
		startChar: number,
		endChar: number,
		message: string,
		severity: vscode.DiagnosticSeverity,
	): void {
		const range = new vscode.Range(line, startChar, line, endChar);
		const diagnostic = new vscode.Diagnostic(range, message, severity);
		diagnostic.source = "view.tree";
		diagnostics.push(diagnostic);
	}

	public clearDiagnostics(document: vscode.TextDocument): void {
		this.diagnosticCollection.delete(document.uri);
	}

	public dispose(): void {
		this.diagnosticCollection.dispose();
	}
}
