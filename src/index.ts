import { ExportGetableNode, Identifier, PropertyAccessExpression, ExpressionStatement, SyntaxKind, VariableDeclaration, ts, CallExpression } from "ts-morph";
import { Project, StructureKind } from "ts-morph";
import { CodeFlowGraph } from "./graph.js";

CodeFlowGraph
// initialize
const project = new Project({
    // Optionally specify compiler options, tsconfig.json, in-memory file system, and more here.
    // If you initialize with a tsconfig.json, then it will automatically populate the project
    // with the associated source files.
    // Read more: https://ts-morph.com/setup/
});

// const ROOT_DIR: string = "Tryaway/**/*.ts";
const ROOT_DIR: string = "Tryaway/**/*.ts";

const codeflow = new CodeFlowGraph();

codeflow.addSourceFilesAtPaths(ROOT_DIR);
codeflow.initialize();
// codeflow.printNodes();
codeflow.writeToJSON(`Tryaway.json`);