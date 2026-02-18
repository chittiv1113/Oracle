import type { QueryConfig } from '../chunker.js';
import { resolveWasmPath } from './wasm-resolver.js';

/**
 * Tree-sitter query configuration for Python.
 *
 * Captures functions, classes, and methods with their names.
 */
export const pythonQueryConfig: QueryConfig = {
  language: 'python',
  extensions: ['.py'],
  wasmPath: resolveWasmPath('node_modules/tree-sitter-wasms/out/tree-sitter-python.wasm'),
  queryString: `
    ; Function definitions (top-level and nested)
    (function_definition
      name: (identifier) @func_name) @function

    ; Class definitions
    (class_definition
      name: (identifier) @class_name) @class

    ; Methods are function_definition nodes inside class bodies
    ; The chunker will detect context based on parent node
  `,
};
