import { Project, SyntaxKind } from "ts-morph";
import * as fs from 'fs';
import * as path from 'path';
var NodeType;
(function (NodeType) {
    NodeType[NodeType["Function"] = 0] = "Function";
    NodeType[NodeType["Call"] = 1] = "Call";
    NodeType[NodeType["Argument"] = 2] = "Argument";
    NodeType[NodeType["Object"] = 3] = "Object";
    NodeType[NodeType["Any"] = 4] = "Any";
})(NodeType || (NodeType = {}));
function nodeTypeToString(nodeType) {
    switch (nodeType) {
        case NodeType.Function:
            return 'Function';
        case NodeType.Call:
            return 'Call';
        case NodeType.Argument:
            return 'Argument';
        case NodeType.Object:
            return 'Object';
        case NodeType.Any:
            return 'Any';
        default:
            throw new Error(`Unknown NodeType: ${nodeType}`);
    }
}
export class NodeInfo {
    /**
     * Reference to the internal `ts-morph` node we represent
     */
    node;
    codeflow;
    incoming;
    outgoing;
    id;
    type;
    constructor(node, codeflow, id, type) {
        this.node = node;
        this.codeflow = codeflow;
        this.incoming = [];
        this.outgoing = [];
        this.id = id;
        this.type = type;
    }
    addIncoming(edge) {
        this.incoming.push(edge);
    }
    addOutgoing(edge) {
        this.outgoing.push(edge);
    }
    print() {
        const info = {
            id: this.id,
            text: this.node.getText(),
            incoming: this.incoming.map((edgeInfo) => edgeInfo.source.id),
            outgoing: this.outgoing.map((edgeInfo) => edgeInfo.destination.id),
        };
        return JSON.stringify(info, null, 2);
    }
}
var EdgeType;
(function (EdgeType) {
    EdgeType[EdgeType["Child"] = 0] = "Child";
    EdgeType[EdgeType["Argument"] = 1] = "Argument";
    EdgeType[EdgeType["Call"] = 2] = "Call";
})(EdgeType || (EdgeType = {}));
function edgeTypeToString(edgeType) {
    switch (edgeType) {
        case EdgeType.Child:
            return 'Child';
        case EdgeType.Argument:
            return 'Argument';
        case EdgeType.Call:
            return 'Call';
        default:
            throw new Error(`Unknown EdgeType: ${edgeType}`);
    }
}
export class EdgeInfo {
    codeflow;
    source;
    destination;
    id;
    type;
    constructor(codeflow, source, destination, id, type) {
        this.codeflow = codeflow;
        this.source = source;
        this.destination = destination;
        this.id = id;
        this.type = type;
    }
}
export class CodeFlowGraph {
    project;
    nodes;
    nodeToInfo;
    edges;
    // this is like, super inefficient :(
    edgeInfo;
    /**
     * The next unused node id. Whenever we create a new node, we assign it this number, and then do `NEXT_NODE_ID++`.
     */
    NEXT_NODE_ID;
    /**
     * The next unused edge id. Whenever we create a new edge, we assign it this number, and then do `NEXT_EDGE_ID++`.
     */
    NEXT_EDGE_ID;
    constructor() {
        this.project = new Project();
        this.nodes = new Map();
        this.nodeToInfo = new Map();
        this.edges = new Map();
        this.edgeInfo = new Map();
        this.NEXT_NODE_ID = 0;
        this.NEXT_EDGE_ID = 0;
    }
    addSourceFilesAtPaths(fileGlobs) {
        this.project.addSourceFilesAtPaths(fileGlobs);
    }
    /**
     * Analyzes the project for the first time and saturate the
     * nodes and edges
     */
    initialize() {
        for (const sourceFile of this.project.getSourceFiles()) {
            console.log(`Processing: ${sourceFile.getFilePath()}`);
            this.processVariables(sourceFile);
            this.processFunctions(sourceFile);
            this.processClasses(sourceFile);
        }
    }
    /// NOTE: In all of the following functions, we follow the convention
    /// of naming things `process<X>(x: X): NodeInfo | undefined`.
    ///  
    processVariables(sourceFile) {
        const variables = sourceFile.getVariableDeclarations();
        for (const variable of variables) {
            const statement = variable.getVariableStatementOrThrow();
            const declarations = statement.getDeclarations();
            if (!declarations)
                continue;
            for (const declaration of declarations) {
                this.processVariableDeclaration(declaration);
            }
        }
    }
    processFunctions(sourceFile) {
        const functions = sourceFile.getFunctions();
        for (const func of functions) {
            this.processFunctionDeclaration(func);
        }
    }
    processClasses(sourceFile) {
        const classes = sourceFile.getClasses();
        for (const class_ of classes) {
            this.processClass(class_);
        }
    }
    processClass(class_) {
        const methods = class_.getMethods();
        for (const method of methods) {
            this.processMethodDeclaration(method);
        }
    }
    processMethodDeclaration(method) {
        const { node: source, isNew: isNew } = this.addNodeIsNew(method, NodeType.Function);
        if (!isNew)
            return source;
        const calls = method.getBodyOrThrow().getDescendantsOfKind(SyntaxKind.CallExpression);
        for (const call of calls) {
            const callInfo = this.processCallExpression(call);
            this.addEdge(source, callInfo, EdgeType.Child);
        }
        return source;
    }
    /**
     * Given a variable declaration, if it is of the form
     * 1. `const a = <object>`, find all places where we do something like `a.thing(...args)`
     *    and add an edge from `a -> a.thing(...args)`. Then, process `a.thing(...args)`.
     *
     *
     *
     * @param declaration
     * @param export_only
     * @returns
     */
    processVariableDeclaration(declaration, export_only = true) {
        // if the variable is not exported, skip it
        if (export_only && !declaration.isExported()) {
            return undefined;
        }
        const init = declaration.getInitializerOrThrow();
        const functionLike = init.getKind() === SyntaxKind.ArrowFunction || init.getKind() === SyntaxKind.FunctionExpression;
        const { node: source, isNew: isNew } = this.addNodeIsNew(declaration, functionLike ? NodeType.Function : NodeType.Object);
        if (!isNew)
            return source;
        // check if this declaration is function-like
        if (functionLike) {
            const calls = init.getBody().getDescendantsOfKind(SyntaxKind.CallExpression);
            for (const call of calls) {
                const callInfo = this.processCallExpression(call);
                this.addEdge(source, callInfo, EdgeType.Child);
            }
            return source;
        }
        // otherwise, its an object and we check all its references
        const references = declaration.findReferences();
        for (const ref of references) {
            for (const reference of ref.getReferences()) {
                // we want to only extract call expressions
                let temp = reference.getNode().getParentOrThrow();
                let call = temp.getParentOrThrow();
                // must be the `expression` of the call expression
                // I'm not sure how TS works, but hopefully this does a pointer comparison
                if (call.getKind() === SyntaxKind.CallExpression && call.getExpression() === temp) {
                    const callInfo = this.processCallExpression(call);
                    this.addEdge(source, callInfo, EdgeType.Call);
                }
            }
        }
        return source;
    }
    // Given something like `a.thing(...args)` or `thing(...args)`,
    // go to the definition of `thing` and process it. Then, process
    // args, and add all of the edges          
    processCallExpression(call) {
        const { node: source, isNew: isNew } = this.addNodeIsNew(call, NodeType.Call);
        if (!isNew)
            return source;
        const expression = call.getExpression();
        if (expression.getKind() === SyntaxKind.Identifier) {
            const definitions = expression.getDefinitionNodes();
            for (const definition of definitions) {
                const definitionInfo = this.processDefinition(definition);
                for (const edge of definitionInfo.outgoing) {
                    this.addEdge(source, edge.destination, EdgeType.Child);
                }
            }
        }
        for (const arg of call.getArguments()) {
            const argInfo = this.processArgument(arg);
            this.addEdge(source, argInfo, EdgeType.Argument);
        }
        return source;
    }
    processDefinition(definition) {
        let source;
        if (definition.getKind() === SyntaxKind.VariableDeclaration) {
            source = this.processVariableDeclaration(definition);
        }
        else if (definition.getKind() === SyntaxKind.FunctionDeclaration) {
            source = this.processFunctionDeclaration(definition);
        }
        else {
            source = this.addNode(definition, NodeType.Any);
        }
        return source;
    }
    processFunctionDeclaration(func) {
        const { node: source, isNew: isNew } = this.addNodeIsNew(func, NodeType.Function);
        if (!isNew)
            return source;
        const calls = func.getBodyOrThrow().getDescendantsOfKind(SyntaxKind.CallExpression);
        for (const call of calls) {
            const callInfo = this.processCallExpression(call);
            this.addEdge(source, callInfo, EdgeType.Child);
        }
        return source;
    }
    processArgument(node) {
        const { node: source, isNew: isNew } = this.addNodeIsNew(node, NodeType.Argument);
        if (!isNew)
            return source;
        const calls = node.getDescendantsOfKind(SyntaxKind.CallExpression);
        for (const call of calls) {
            const callInfo = this.processCallExpression(call);
            this.addEdge(source, callInfo, EdgeType.Child);
        }
        return source;
    }
    addNodeIsNew(node, type) {
        // does this node already exist?
        const maybeNode = this.nodeToInfo.get(node);
        // if so, just return the existing one
        if (maybeNode !== undefined) {
            return { node: maybeNode, isNew: false };
        }
        // otherwise, add it into the map
        const nodeInfo = new NodeInfo(node, this, this.NEXT_NODE_ID, type);
        this.nodes.set(this.NEXT_NODE_ID, nodeInfo);
        this.nodeToInfo.set(node, nodeInfo);
        this.NEXT_NODE_ID++;
        return { node: nodeInfo, isNew: true };
    }
    addNode(node, type) {
        return this.addNodeIsNew(node, type).node;
    }
    /**
     *
     * @param source
     * @param destination
     * @param type
     * @returns The desired edge, as well as a flag indicating if a new edge was created.
     */
    addEdgeIsNew(source, destination, type) {
        // does this edge already exist?
        const maybeEdge = this.edgeInfo.get([source.id, destination.id]);
        // if so, just return the existing one
        if (maybeEdge !== undefined) {
            return { edge: maybeEdge, isNew: false };
        }
        // otherwise, add it into the map
        const edgeInfo = new EdgeInfo(this, source, destination, this.NEXT_EDGE_ID, type);
        this.edges.set(this.NEXT_EDGE_ID, edgeInfo);
        this.nodes.get(source.id)?.addOutgoing(edgeInfo);
        this.nodes.get(destination.id)?.addIncoming(edgeInfo);
        this.NEXT_EDGE_ID++;
        return { edge: edgeInfo, isNew: true };
    }
    addEdge(source, destination, type) {
        return this.addEdgeIsNew(source, destination, type).edge;
    }
    printNode(node) {
        return node.print();
    }
    printNodes() {
        console.log("All nodes:");
        for (const [_, nodeInfo] of this.nodes.entries()) {
            console.log(nodeInfo.print());
        }
    }
    nodesToJSON() {
        let nodes = [];
        for (const [_, nodeInfo] of this.nodes.entries()) {
            let nodeData;
            if (nodeInfo.type === NodeType.Function) {
                const funLikeNode = nodeInfo.node;
                nodeData = {
                    "name": funLikeNode.getSymbolOrThrow().getName()
                };
            }
            else if (nodeInfo.type === NodeType.Call) {
                nodeData = {
                    "args": nodeInfo.outgoing
                        .filter((edge) => { return edge.type === EdgeType.Argument; })
                        .map((edge) => { return edge.id; })
                };
            }
            else if (nodeInfo.type === NodeType.Argument) {
                nodeData = {};
            }
            else if (nodeInfo.type === NodeType.Object) {
                const objLikeNode = nodeInfo.node;
                nodeData = {
                    "name": objLikeNode.getSymbolOrThrow().getName()
                };
            }
            else if (nodeInfo.type === NodeType.Any) {
                nodeData = {};
            }
            const nodePath = path.relative('/home/hantingz/lavalab/learn2/', nodeInfo.node.getSourceFile().getFilePath());
            const node = {
                "id": nodeInfo.id,
                "class": nodeTypeToString(nodeInfo.type),
                "location": `${nodePath}:${nodeInfo.node.getStartLineNumber()}`,
                "raw_source": nodeInfo.node.getText(),
                "incoming": nodeInfo.incoming
                    .map((edge) => { return edge.id; }),
                "outgoing": nodeInfo.outgoing
                    .filter((edge) => {
                    if (edge.type === EdgeType.Argument && nodeInfo.type !== NodeType.Call) {
                        throw "cannot have argument edges in non-Call nodes";
                    }
                    return edge.type !== EdgeType.Argument;
                })
                    .map((edge) => { return edge.id; }),
                "node_data": nodeData
            };
            nodes.push(node);
        }
        return {
            "nodes": nodes
        };
    }
    edgesToJSON() {
        let edges = [];
        for (const [_, edgeInfo] of this.edges.entries()) {
            let edge = {
                "id": edgeInfo.id,
                "type": edgeTypeToString(edgeInfo.type),
                "source_node_id": edgeInfo.source.id,
                "destination_node_id": edgeInfo.destination.id,
                "label": ""
            };
            edges.push(edge);
        }
        return { "edges": edges
        };
    }
    writeToJSON(fileName) {
        const data = {
            "nodes": this.nodesToJSON().nodes,
            "edges": this.edgesToJSON().edges
        };
        fs.writeFile(fileName, JSON.stringify(data, null, 2), (err) => {
            if (err)
                throw err;
            console.log('Data written to file');
        });
    }
}
//# sourceMappingURL=graph.js.map