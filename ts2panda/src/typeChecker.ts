import ts, { forEachChild } from "typescript";
import { ClassType, ExternalType } from "./base/typeSystem";
import { ModuleStmt } from "./modules";
import { TypeRecorder } from "./typeRecorder";
import * as jshelpers from "./jshelpers";
import { LOGD } from "./log";

export class TypeChecker {
    private static instance: TypeChecker;
    private compiledTypeChecker: any = null;
    private constructor() { }

    public static getInstance(): TypeChecker {
        if (!TypeChecker.instance) {
            TypeChecker.instance = new TypeChecker();
        }
        return TypeChecker.instance;
    }

    public setTypeChecker(typeChecker: ts.TypeChecker) {
        this.compiledTypeChecker = typeChecker;
    }

    public getTypeChecker(): ts.TypeChecker {
        return this.compiledTypeChecker;
    }

    public getTypeDeclForIdentifier(node: ts.Node) {
        if (node.kind == ts.SyntaxKind.ClassExpression) {
            return node;
        }
        let symbol = this.compiledTypeChecker.getSymbolAtLocation(node);
        if (symbol && symbol.declarations) {
            return symbol.declarations[0];
        }
        LOGD("TypeDecl NOT FOUND for: " + node.getFullText());
        return null;
    }

    public getTypeFlagsAtLocation(node: ts.Node): string {
        let typeFlag = this.compiledTypeChecker.getTypeAtLocation(node).getFlags();
        return ts.TypeFlags[typeFlag].toUpperCase();
    }

    public checkExportKeyword(node: ts.Node): boolean {
        if (node.modifiers) {
            for (let modifier of node.modifiers) {
                if (modifier.kind === ts.SyntaxKind.ExportKeyword) {
                    return true;
                }
            }
        }
        return false;
    }

    private getTypeDeclForInitializer(initializer: ts.Node, exportNeeded:boolean) {
        switch (initializer.kind) {
            // only create the type when it was used (initialized) or TODO: exported
            // NewExpression initializer means that the type is a new class (TODO: or other object later, but is there any?)
            case ts.SyntaxKind.NewExpression:
                let initializerExpression = <ts.NewExpression>initializer;
                return this.getTypeDeclForIdentifier(initializerExpression.expression);
            case ts.SyntaxKind.ClassExpression:
                if (exportNeeded) {
                    return initializer;
                }
                break;
            // Or the initializer is a variable
            case ts.SyntaxKind.Identifier:
                // other types, functions/primitives...
                return this.getTypeDeclForIdentifier(initializer);
            case ts.SyntaxKind.PropertyAccessExpression:
                return initializer;
            default:
                break;
            return null;
        }
    }

    // If newExpressionFlag is ture, the type has to be created no mater the export is needed or 
    //not, while newExpressionFlag if false, the export has to be needed.
    private checkForTypeDecl(originalName: ts.Node, typeDeclNode: ts.Node, exportNeeded: boolean, newExpressionFlag: boolean) {
        switch (typeDeclNode.kind) {
            // Type found to be defined a classDeclaration or classExpression
            case ts.SyntaxKind.ClassDeclaration:
            case ts.SyntaxKind.ClassExpression:
                let origTypeDeclNode = <ts.ClassDeclaration>ts.getOriginalNode(typeDeclNode);
                let classTypeIndex = TypeRecorder.getInstance().tryGetTypeIndex(origTypeDeclNode);
                if (classTypeIndex == -1) {
                    new ClassType(<ts.ClassDeclaration>origTypeDeclNode, newExpressionFlag, originalName);
                    if (newExpressionFlag) {
                        classTypeIndex = TypeRecorder.getInstance().tryGetVariable2Type(originalName);
                    } else {
                        classTypeIndex = TypeRecorder.getInstance().tryGetTypeIndex(origTypeDeclNode);
                    }
                }
                if (exportNeeded) {
                    let exportedName = jshelpers.getTextOfIdentifierOrLiteral(originalName);
                    TypeRecorder.getInstance().setExportedType(exportedName, classTypeIndex, true);
                }
                break;
            // The type was passed by a variable, need to keep search in deep
            case ts.SyntaxKind.VariableDeclaration:
                let varDeclNode = <ts.VariableDeclaration>typeDeclNode;
                let nextInitializer = varDeclNode.initializer;
                if (nextInitializer) {
                    let nextTypeDeclNode = this.getTypeDeclForInitializer(nextInitializer, exportNeeded);
                    if (nextTypeDeclNode) {
                        this.checkForTypeDecl(originalName, nextTypeDeclNode, exportNeeded, newExpressionFlag);
                    }
                }
                break;
            case ts.SyntaxKind.ImportSpecifier:
            case ts.SyntaxKind.ImportClause:
                let ImportTypeIndex = TypeRecorder.getInstance().tryGetTypeIndex(typeDeclNode);
                if (ImportTypeIndex != -1) {
                    TypeRecorder.getInstance().setVariable2Type(originalName, ImportTypeIndex, true);
                } else {
                    // console.log("-> ERROR: missing imported type for: ", jshelpers.getTextOfIdentifierOrLiteral(originalName));
                }
                break;
            case ts.SyntaxKind.PropertyAccessExpression:
                let propertyAccessExpression = <ts.PropertyAccessExpression>typeDeclNode;
                let localName = jshelpers.getTextOfIdentifierOrLiteral(propertyAccessExpression.expression);
                let externalName = jshelpers.getTextOfIdentifierOrLiteral(propertyAccessExpression.name);
                if (TypeRecorder.getInstance().inNampespaceMap(localName)) {
                    let redirectPath = TypeRecorder.getInstance().getPathForNamespace(localName)!;
                    let externalType = new ExternalType(externalName, redirectPath);
                    let ImportTypeIndex = externalType.getTypeIndex();
                    TypeRecorder.getInstance().setVariable2Type(originalName, TypeRecorder.getInstance().shiftType(ImportTypeIndex), true);
                } else {
                    // console.log("-> ERROR: missing imported type for: ", jshelpers.getTextOfIdentifierOrLiteral(originalName));
                }
        }
    }

    public checkTypeForVariableDeclaration(node: ts.VariableDeclaration, exportNeeded: boolean) {
        let name = node.name;
        let initializer = node.initializer;
        if (initializer) {
            let typeDeclNode = this.getTypeDeclForInitializer(initializer, exportNeeded);
            let newExpressionFlag = initializer.kind == ts.SyntaxKind.NewExpression;
            if (typeDeclNode) {
                this.checkForTypeDecl(name, typeDeclNode, exportNeeded, newExpressionFlag);
            }
        }
    }

    // Entry for type recording, only process node that will need a type to be created
    public formatNodeType(node: ts.Node, importOrExportStmt?: ModuleStmt) {
        if (this.compiledTypeChecker === null) {
            return;
        }
        switch(node.kind) {
            case ts.SyntaxKind.VariableStatement:
                // For varibaleStatemnt, need to check what kind of type the variable was set to
                const variableStatementNode = <ts.VariableStatement>node;
                const decList = variableStatementNode.declarationList;
                let exportNeeded = this.checkExportKeyword(node);
                decList.declarations.forEach(declaration => {
                    this.checkTypeForVariableDeclaration(declaration, exportNeeded);
                });
                break;
            case ts.SyntaxKind.ClassDeclaration:
                // Only create the type if it is exported. 
                // Otherwise, waite until it gets instantiated
                let classDeclNode = <ts.ClassDeclaration>ts.getOriginalNode(node);
                if (this.checkExportKeyword(node)) {
                    let classType = new ClassType(classDeclNode, false);
                    let typeIndex = classType.getTypeIndex();
                    let className = classDeclNode.name;
                    let exportedName = "default";
                    if (className) {
                        exportedName = jshelpers.getTextOfIdentifierOrLiteral(className);
                    }
                    TypeRecorder.getInstance().setExportedType(exportedName, typeIndex, false);
                }
                break;
            case ts.SyntaxKind.ExportDeclaration:
                if (importOrExportStmt) {
                    TypeRecorder.getInstance().addExportedType(importOrExportStmt);
                }
                break;
            case ts.SyntaxKind.ImportDeclaration:
                if (importOrExportStmt) {
                    TypeRecorder.getInstance().addImportedType(importOrExportStmt);
                }
                break;
            case ts.SyntaxKind.ExportAssignment:
                let exportAssignmentNode = <ts.ExportAssignment>node;
                let expression = exportAssignmentNode.expression;
                let exportedName = "default";
                let expressionType = this.compiledTypeChecker.getTypeAtLocation(expression);
                let typeNode = expressionType.getSymbol()?.valueDeclaration;
                TypeRecorder.getInstance().addNonReExportedType(exportedName, typeNode);
                break;
        }
    }

}
