/**
 * Types for `compat.js`.
 *
 * That file is deliberately plain script source with no imports or exports:
 * the same bytes are prepended verbatim to the pdf.js worker bundle at build
 * time, where a module wrapper would break it. It is imported purely for its
 * side effect of installing the shims, so it exports nothing.
 */
export {};
