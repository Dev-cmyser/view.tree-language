# view.tree-language

Advanced [view.tree language](https://github.com/hyoo-ru/mam_mol/blob/master/view/readme.md#viewtree) support for [Visual Studio Code](https://code.visualstudio.com).

## ✨ Features

### 🔍 **IntelliSense & Autocompletion**
- Smart autocompletion for `$components` and their properties
- Context-aware suggestions based on current component
- Built-in `$mol` components support
- Property type hints and documentation

### 🎯 **Navigation & Definition**
- **Go to Definition** (F12) for components
- **Find All References** for component usage
- Smart component and property recognition
- Cross-file navigation support

### 🔧 **Refactoring & Rename**
- **Rename Symbol** (F2) for components across entire project
- Automatic file renaming for component files
- Safe refactoring with validation
- Maintains component relationships

### 🩺 **Diagnostics & Validation**
- Real-time syntax validation for `.view.tree` files
- Component existence checking
- Property validation against component definitions
- Binding syntax validation
- Error highlighting and suggestions

### 💡 **Hover Information**
- Rich hover tooltips with component information
- Property descriptions and usage examples
- File location and component structure
- Built-in component documentation

### 👁️ **Live Preview**
- Visual component structure preview
- Real-time updates as you edit
- Interactive component navigation
- Property and binding visualization

### 🛠️ **Module Assistant Manager (MAM)**
- Quick component creation commands
- Automatic file generation (`.ts`, `.view.tree`, `.view.css.ts`)
- Project structure management
- Template-based scaffolding

## 📋 Available Commands

| Command | Description |
|---------|-------------|
| `MAM: New module (.ts)` | Create new TypeScript module |
| `MAM: New module (.view.tree)` | Create new view.tree module |
| `MAM: Create .view.ts` | Generate TypeScript file from .view.tree |
| `MAM: Create .view.css.ts` | Generate CSS TypeScript file |
| `Go to Definition` (F12) | Navigate to component definition |
| `Rename Symbol` (F2) | Rename component across project |

## 🚀 Getting Started

1. Install the extension from VS Code marketplace
2. Open a project with `.view.tree` files
3. Start typing `$` to get component suggestions
4. Use F12 to navigate to component definitions
5. Use F2 to rename components safely
6. Check the **View Tree Preview** panel for live visualization

## 💻 Supported Features

### Component Recognition
- Automatically scans `.ts` and `.view.tree` files
- Extracts component properties and methods
- Maintains real-time project index
- Supports nested component structures

### Smart Completion
- Component names with `$` prefix
- Property suggestions based on component type
- Value completion for boolean properties
- Snippet expansion for common patterns

### Validation Rules
- Component name format validation
- Property existence checking
- Binding syntax verification
- Type-appropriate value validation

### File Operations
- Component file creation and management
- Automatic imports and exports
- Cross-reference maintenance
- Project structure consistency

## 🔧 Configuration

The extension works out of the box with no configuration required. It automatically:
- Scans your workspace for `.view.tree` and `.ts` files
- Builds a component index for IntelliSense
- Provides real-time validation and suggestions
- Updates the preview panel as you edit

## 📖 Usage Examples

### Creating a Component
```tree
$my_component $mol_view
	title <= /Hello World
	sub /
		<= Button $mol_button
			title <= "Click me"
			click <= () => this.handle_click()
```

### Using IntelliSense
1. Type `$` to see available components
2. Select a component and press Tab
3. Type `Tab` to see available properties
4. Get type hints and documentation on hover

### Navigation
- Press F12 on any `$component` to go to its definition
- Use F2 to rename components across the entire project
- Right-click for context menu actions

## 🤝 Contributing

This extension is open source and welcomes contributions. Feel free to submit issues, feature requests, or pull requests.

## 📄 License

MIT License - see LICENSE file for details.
