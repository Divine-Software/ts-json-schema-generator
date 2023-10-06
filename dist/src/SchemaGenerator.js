"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SchemaGenerator = void 0;
const typescript_1 = __importDefault(require("typescript"));
const NoRootTypeError_1 = require("./Error/NoRootTypeError");
const NodeParser_1 = require("./NodeParser");
const DefinitionType_1 = require("./Type/DefinitionType");
const symbolAtNode_1 = require("./Utils/symbolAtNode");
const removeUnreachable_1 = require("./Utils/removeUnreachable");
const hasJsDocTag_1 = require("./Utils/hasJsDocTag");
class SchemaGenerator {
    constructor(program, nodeParser, typeFormatter, config) {
        this.program = program;
        this.nodeParser = nodeParser;
        this.typeFormatter = typeFormatter;
        this.config = config;
    }
    createSchema(fullName, typeMapResult) {
        const rootNodes = this.getRootNodes(fullName);
        return this.createSchemaFromNodes(rootNodes, typeMapResult);
    }
    createSchemaFromNodes(rootNodes, typeMapResult) {
        var _a;
        const rootTypes = rootNodes.map((rootNode) => {
            return this.nodeParser.createType(rootNode, new NodeParser_1.Context());
        });
        const rootTypeDefinition = rootTypes.length === 1 ? this.getRootTypeDefinition(rootTypes[0]) : undefined;
        const definitions = {};
        const rootTypeNames = rootTypes.map((rootType) => this.appendRootChildDefinitions(rootType, definitions));
        const reachableDefinitions = (0, removeUnreachable_1.removeUnreachable)(rootTypeDefinition, definitions);
        typeMapResult === null || typeMapResult === void 0 ? void 0 : typeMapResult.splice(0, Infinity, ...this.createTypeMaps(rootNodes, rootTypeNames, reachableDefinitions));
        return {
            ...(((_a = this.config) === null || _a === void 0 ? void 0 : _a.schemaId) ? { $id: this.config.schemaId } : {}),
            $schema: "http://json-schema.org/draft-07/schema#",
            ...(rootTypeDefinition !== null && rootTypeDefinition !== void 0 ? rootTypeDefinition : {}),
            definitions: reachableDefinitions,
        };
    }
    createTypeMaps(rootNodes, rootTypeNames, reachableDefinitions) {
        const typeMaps = {};
        const typeSeen = new Set();
        const nameSeen = new Set();
        rootNodes.forEach((rootNode, i) => {
            var _a, _b;
            const sourceFile = rootNode.getSourceFile();
            const fileName = sourceFile.fileName;
            const typeMap = ((_a = typeMaps[fileName]) !== null && _a !== void 0 ? _a : (typeMaps[fileName] = {
                fileName,
                typeNames: [],
                exports: typescript_1.default.isExternalModule(sourceFile) ? [] : undefined,
            }));
            const typeNames = rootTypeNames[i].filter((typeName) => !!reachableDefinitions[typeName] && !typeName.startsWith("NamedParameters<typeof "));
            const exports = typeNames
                .map((typeName) => typeName.replace(/[<.].*/g, ""))
                .filter((type) => { var _a, _b; return (_b = (_a = (0, symbolAtNode_1.symbolAtNode)(sourceFile)) === null || _a === void 0 ? void 0 : _a.exports) === null || _b === void 0 ? void 0 : _b.has(typescript_1.default.escapeLeadingUnderscores(type)); })
                .filter((type) => !typeSeen.has(type) && typeSeen.add(type));
            typeMap.typeNames.push(...typeNames.filter((name) => !nameSeen.has(name) && nameSeen.add(name)));
            (_b = typeMap.exports) === null || _b === void 0 ? void 0 : _b.push(...exports);
        });
        return Object.values(typeMaps).filter((tm) => !tm.exports || tm.exports.length || tm.typeNames.length);
    }
    getRootNodes(fullName) {
        if (fullName && fullName !== "*") {
            return [this.findNamedNode(fullName)];
        }
        else {
            const rootFileNames = this.program.getRootFileNames();
            const rootSourceFiles = this.program
                .getSourceFiles()
                .filter((sourceFile) => rootFileNames.includes(sourceFile.fileName));
            const rootNodes = new Map();
            this.appendTypes(rootSourceFiles, this.program.getTypeChecker(), rootNodes);
            return [...rootNodes.values()];
        }
    }
    findNamedNode(fullName) {
        const typeChecker = this.program.getTypeChecker();
        const allTypes = new Map();
        const { projectFiles, externalFiles } = this.partitionFiles();
        this.appendTypes(projectFiles, typeChecker, allTypes);
        if (allTypes.has(fullName)) {
            return allTypes.get(fullName);
        }
        this.appendTypes(externalFiles, typeChecker, allTypes);
        if (allTypes.has(fullName)) {
            return allTypes.get(fullName);
        }
        throw new NoRootTypeError_1.NoRootTypeError(fullName);
    }
    getRootTypeDefinition(rootType) {
        return this.typeFormatter.getDefinition(rootType);
    }
    appendRootChildDefinitions(rootType, childDefinitions) {
        const seen = new Set();
        const children = this.typeFormatter
            .getChildren(rootType)
            .filter((child) => child instanceof DefinitionType_1.DefinitionType)
            .filter((child) => {
            if (!seen.has(child.getId())) {
                seen.add(child.getId());
                return true;
            }
            return false;
        });
        const ids = new Map();
        for (const child of children) {
            const name = child.getName();
            const previousId = ids.get(name);
            const childId = child.getId().replace(/def-/g, "");
            if (previousId && childId !== previousId) {
                throw new Error(`Type "${name}" has multiple definitions.`);
            }
            ids.set(name, childId);
        }
        const names = [];
        children.reduce((definitions, child) => {
            const name = child.getName();
            if (!(name in definitions)) {
                definitions[name] = this.typeFormatter.getDefinition(child.getType());
            }
            names.push(name);
            return definitions;
        }, childDefinitions);
        return names;
    }
    partitionFiles() {
        const projectFiles = new Array();
        const externalFiles = new Array();
        for (const sourceFile of this.program.getSourceFiles()) {
            const destination = sourceFile.fileName.includes("/node_modules/") ? externalFiles : projectFiles;
            destination.push(sourceFile);
        }
        return { projectFiles, externalFiles };
    }
    appendTypes(sourceFiles, typeChecker, types) {
        for (const sourceFile of sourceFiles) {
            this.inspectNode(sourceFile, typeChecker, types);
        }
    }
    inspectNode(node, typeChecker, allTypes) {
        var _a, _b, _c;
        switch (node.kind) {
            case typescript_1.default.SyntaxKind.VariableDeclaration: {
                const variableDeclarationNode = node;
                if (((_a = variableDeclarationNode.initializer) === null || _a === void 0 ? void 0 : _a.kind) === typescript_1.default.SyntaxKind.ArrowFunction ||
                    ((_b = variableDeclarationNode.initializer) === null || _b === void 0 ? void 0 : _b.kind) === typescript_1.default.SyntaxKind.FunctionExpression) {
                    this.inspectNode(variableDeclarationNode.initializer, typeChecker, allTypes);
                }
                return;
            }
            case typescript_1.default.SyntaxKind.InterfaceDeclaration:
            case typescript_1.default.SyntaxKind.ClassDeclaration:
            case typescript_1.default.SyntaxKind.EnumDeclaration:
            case typescript_1.default.SyntaxKind.TypeAliasDeclaration:
                if (((_c = this.config) === null || _c === void 0 ? void 0 : _c.expose) === "all" ||
                    (this.isExportType(node) && !this.isGenericType(node))) {
                    allTypes.set(this.getFullName(node, typeChecker), node);
                    return;
                }
                return;
            case typescript_1.default.SyntaxKind.FunctionDeclaration:
            case typescript_1.default.SyntaxKind.FunctionExpression:
            case typescript_1.default.SyntaxKind.ArrowFunction:
                allTypes.set(`NamedParameters<typeof ${this.getFullName(node, typeChecker)}>`, node);
                return;
            default:
                typescript_1.default.forEachChild(node, (subnode) => this.inspectNode(subnode, typeChecker, allTypes));
                return;
        }
    }
    isExportType(node) {
        var _a;
        if (((_a = this.config) === null || _a === void 0 ? void 0 : _a.jsDoc) !== "none" && (0, hasJsDocTag_1.hasJsDocTag)(node, "internal")) {
            return false;
        }
        const localSymbol = (0, symbolAtNode_1.localSymbolAtNode)(node);
        return localSymbol ? "exportSymbol" in localSymbol : false;
    }
    isGenericType(node) {
        return !!(node.typeParameters && node.typeParameters.length > 0);
    }
    getFullName(node, typeChecker) {
        const symbol = (0, symbolAtNode_1.symbolAtNode)(node);
        return typeChecker.getFullyQualifiedName(symbol).replace(/".*"\./, "");
    }
}
exports.SchemaGenerator = SchemaGenerator;
//# sourceMappingURL=SchemaGenerator.js.map