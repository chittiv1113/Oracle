import type { QueryConfig } from '../chunker.js';
import { resolveWasmPath } from './wasm-resolver.js';

/**
 * Tree-sitter query configuration for JavaScript/JSX.
 *
 * Captures functions, classes, methods, and arrow functions with their names.
 */
export const javascriptQueryConfig: QueryConfig = {
  language: 'javascript',
  extensions: ['.js', '.jsx', '.mjs', '.cjs'],
  wasmPath: resolveWasmPath('node_modules/tree-sitter-wasms/out/tree-sitter-javascript.wasm'),
  queryString: `
    ; Function declarations
    (function_declaration
      name: (identifier) @func_name) @function

    ; Class declarations
    (class_declaration
      name: (identifier) @class_name) @class

    ; Method definitions (in classes)
    (method_definition
      name: (property_identifier) @method_name) @method

    ; Arrow functions assigned to variables
    (lexical_declaration
      (variable_declarator
        name: (identifier) @func_name
        value: (arrow_function) @function))

    ; Arrow functions assigned to var/let/const
    (variable_declaration
      (variable_declarator
        name: (identifier) @func_name
        value: (arrow_function) @function))

    ; Exported function declarations
    (export_statement
      declaration: (function_declaration
        name: (identifier) @func_name) @function)

    ; Exported class declarations
    (export_statement
      declaration: (class_declaration
        name: (identifier) @class_name) @class)
  `,
};
