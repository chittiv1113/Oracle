import type { QueryConfig } from '../chunker.js';
import { resolveWasmPath } from './wasm-resolver.js';

/**
 * Tree-sitter query configuration for TypeScript/TSX.
 *
 * Captures functions, classes, methods, and arrow functions with their names.
 */
export const typescriptQueryConfig: QueryConfig = {
  language: 'typescript',
  extensions: ['.ts', '.tsx'],
  wasmPath: resolveWasmPath('node_modules/tree-sitter-wasms/out/tree-sitter-typescript.wasm'),
  queryString: `
    ; Function declarations (both exported and non-exported)
    (function_declaration
      name: (identifier) @func_name) @function

    ; Class declarations (both exported and non-exported)
    (class_declaration
      name: (type_identifier) @class_name) @class

    ; Method definitions (in classes)
    (method_definition
      name: (property_identifier) @method_name) @method

    ; Arrow functions assigned to variables
    (lexical_declaration
      (variable_declarator
        name: (identifier) @func_name
        value: (arrow_function) @function))

    ; Arrow functions assigned to const
    (variable_declaration
      (variable_declarator
        name: (identifier) @func_name
        value: (arrow_function) @function))
  `,
};
