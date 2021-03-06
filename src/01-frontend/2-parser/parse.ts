import { makePeekingIterator } from '../../functions/decorator/makePeekingIterator'
import { LRStack } from '../../functions/LRStack'
import * as Lang from '../../language'
import { Token } from '../1-lexer'
import { SyntaxError } from '../SyntaxError'
import * as Syntax from './syntax'
import { EphemeralArgumentList } from './syntax'
import { Action, LR_TOKEN, Production, reduction, transitions } from './transitions'

type LRStackSymbol = Syntax.Node | Token<Production> | Token

export function parse(tokenIterator: Iterator<Token>): Syntax.Program {
	const tokens = makePeekingIterator<Token>(tokenIterator)
	const stack = new LRStack<LRStackSymbol>()
	// @ts-ignore
	const isSymbol: (x: LRStackSymbol | number) => x is LRStackSymbol = x => typeof x !== 'number'

	stack.push(0)

	do {
		// Last state (number)
		const state = stack.lastState()
		// Last element
		const lastEntry = stack.last()
		// Next token, if none exists $ signifies the end
		const { token: nextToken = '$' } = tokens.peek() || {}

		// If the last entry is a state then we use the next token to get the input column number
		// If not that means we reduced and haven't done a GOTO
		// so we get the input column number for our last token to get the GOTO
		const input = LR_TOKEN[isSymbol(lastEntry) ? lastEntry.token : nextToken]
		// Get the transition via the current state and input column
		const transition = transitions[state][input]

		// console.log(JSON.stringify(stack.stack.filter<LRStackSymbol>(isSymbol).map(x => x.token)))

		// No such transition
		if (transition === null) {
			const { token, start, width } = tokens.next().value
			throw new SyntaxError(`Unexpected token ${token}`, start, width)
		}

		const [action, transitionNumber] = transition

		// Input has been accepted
		if (action === Action.ACCEPT) {
			break
		}

		if (action === Action.GOTO) {
			stack.push(transitionNumber)
			continue
		}

		if (action === Action.SHIFT) {
			stack.push(tokens.next().value)
			stack.push(transitionNumber)
			continue
		}

		if (action === Action.REDUCE) {
			// Get the reduced production number
			const [production, definition] = reduction[transitionNumber]
			// Pop 2x tokens where x is the number of tokens in the production derivation
			const poppedTokens = stack.pop(definition.length * 2).filter(isSymbol)
			// Sum the width from all the popped tokens, this is the new token width
			const lastPoppedToken = poppedTokens[poppedTokens.length - 1]
			const poppedWidth = lastPoppedToken.start + lastPoppedToken.width - poppedTokens[0].start

			stack.push(reducer[production as Production](poppedTokens, poppedWidth))
		}
	} while (true)

	return stack.stack[1] as Syntax.Program
}

const reducer: Record<Production, (nodes: Array<LRStackSymbol>, reductionWidth: number) => Syntax.Node> = {
	[Production.PROGRAM]: function([node]): Syntax.Program {
		return new Syntax.Program(node as Syntax.Block)
	},

	[Production.BLOCK]: function(nodes): Syntax.Block {
		let block: Syntax.Block

		if (nodes[1]) {
			block = nodes[0] as Syntax.Block
			block.add(nodes[1] as Syntax.Statement)
		} else {
			block = new Syntax.Block(nodes[0].start, nodes[0].width, [nodes[0] as Syntax.Statement])
		}

		return block
	},

	[Production.STMT]: function([node]): Syntax.Statement {
		node.token = Production.STMT
		return node as Syntax.Statement
	},

	[Production.IDEN]: function([identifier]): Syntax.Identifier {
		return new Syntax.Identifier(identifier.start, identifier.width, identifier.content!)
	},

	[Production.EXPR]: function([node]): Syntax.Expression {
		switch (node.token) {
			case Lang.Token.Literal.STRING:
				return new Syntax.StringLiteral(node.start, node.width, node.content!.slice(1, -1))

			case Lang.Token.Literal.NUMERIC:
				return new Syntax.NumericLiteral(node.start, node.width, Number.parseInt(node.content!))

			case Lang.Token.Literal.FLOAT:
				return new Syntax.FloatLiteral(node.start, node.width, Number.parseFloat(node.content!))

			case Lang.Token.Keyword.FALSE:
			case Lang.Token.Keyword.TRUE:
				return new Syntax.BooleanLiteral(node.start, node.width, node.content === 'true')

			default:
				node.token = Production.EXPR
				break
		}

		return node as Syntax.Expression
	},

	[Production.PAREND_EXPR]: function([, node]): Syntax.Expression {
		;(node as Syntax.Expression).parenthesized = true
		return node as Syntax.Expression
	},

	[Production.TYPE]: function(nodes, width): Syntax.Type {
		if (nodes[0].token === Lang.Token.Punctuation.OPEN_PAREN) {
			let params: Array<Syntax.Parameter> = []

			if (nodes[1].token !== Lang.Token.Punctuation.CLOSE_PAREN) {
				params = (nodes.splice(1, 1)[0] as Syntax.EphemeralParameterList).parameters
			}

			return new Syntax.FunctionType(nodes[0].start, width, params, nodes[3] as Syntax.Type)
		}

		const typeKW = nodes[0] as Token<Lang.Token.Type>
		switch (typeKW.token) {
			case Lang.Token.Type.VOID:
				return new Syntax.Type(Syntax.Kind.VoidType, typeKW.start, typeKW.width)
			case Lang.Token.Type.BOOL:
				return new Syntax.Type(Syntax.Kind.BoolType, typeKW.start, typeKW.width)
			case Lang.Token.Type.STRING:
				return new Syntax.Type(Syntax.Kind.StringType, typeKW.start, typeKW.width)
			case Lang.Token.Type.INT8:
				return new Syntax.Type(Syntax.Kind.Int8Type, typeKW.start, typeKW.width)
			case Lang.Token.Type.INT16:
				return new Syntax.Type(Syntax.Kind.Int16Type, typeKW.start, typeKW.width)
			case Lang.Token.Type.INT32:
				return new Syntax.Type(Syntax.Kind.Int32Type, typeKW.start, typeKW.width)
			case Lang.Token.Type.INT64:
				return new Syntax.Type(Syntax.Kind.Int64Type, typeKW.start, typeKW.width)
			case Lang.Token.Type.INT128:
				return new Syntax.Type(Syntax.Kind.Int128Type, typeKW.start, typeKW.width)
			case Lang.Token.Type.UINT8:
				return new Syntax.Type(Syntax.Kind.UInt8Type, typeKW.start, typeKW.width)
			case Lang.Token.Type.UINT16:
				return new Syntax.Type(Syntax.Kind.UInt16Type, typeKW.start, typeKW.width)
			case Lang.Token.Type.UINT32:
				return new Syntax.Type(Syntax.Kind.UInt32Type, typeKW.start, typeKW.width)
			case Lang.Token.Type.UINT64:
				return new Syntax.Type(Syntax.Kind.UInt64Type, typeKW.start, typeKW.width)
			case Lang.Token.Type.UINT128:
				return new Syntax.Type(Syntax.Kind.UInt128Type, typeKW.start, typeKW.width)
			case Lang.Token.Type.FLOAT32:
				return new Syntax.Type(Syntax.Kind.Float32Type, typeKW.start, typeKW.width)
			case Lang.Token.Type.FLOAT64:
				return new Syntax.Type(Syntax.Kind.Float64Type, typeKW.start, typeKW.width)
		}
	},

	[Production.BIN_OP_EXPR]: function(nodes): Syntax.BinaryOperationExpression {
		return (nodes[1] as Syntax.EphemeralBinaryOperationExpressionTail).attach(nodes[0] as Syntax.Expression)
	},

	[Production.BIN_OP_EXPR_TAIL]: function(nodes, width): Syntax.EphemeralBinaryOperationExpressionTail {
		return new Syntax.EphemeralBinaryOperationExpressionTail(
			nodes[0].start,
			width,
			nodes[0].token as Lang.Token.Operator,
			nodes[1] as Syntax.Expression
		)
	},

	[Production.VAR_DEC_STMT]: function(nodes, width): Syntax.VariableDeclarationStatement {
		const { start } = nodes[0]

		// Shift let keyword
		nodes.shift()
		// Shift mut keyword if it exists
		const isMutable = Boolean(nodes[0].token === Lang.Token.Keyword.MUT && nodes.shift())
		// @ts-ignore
		const identifier: Syntax.Identifier = nodes.shift()!
		// Shift colon and type if a colon exists, if not then there is no type declared
		// @ts-ignore
		const type: undefined | Syntax.Type =
			nodes[0].token === Lang.Token.Punctuation.COLON ? (nodes.shift(), nodes.shift()) : undefined
		// Shift assignment operator
		nodes.shift()
		// @ts-ignore
		const expression: Syntax.Expression = nodes.shift()!

		return new Syntax.VariableDeclarationStatement(start, width, isMutable, type, identifier, expression)
	},

	[Production.RETURN_STMT]: function(nodes, width): Syntax.ReturnStatement {
		return new Syntax.ReturnStatement(nodes[0].start, width, nodes[1] as Syntax.Expression)
	},

	[Production.IF_STMT]: function(nodes, width): Syntax.IfStatement {
		if (nodes[0].token === Lang.Token.Keyword.IF) {
			return new Syntax.IfStatement(
				nodes[0].start,
				width,
				nodes[2] as Syntax.Expression,
				nodes[5] as Syntax.Block
			)
		}

		;(nodes[0] as Syntax.IfStatement).addElseIfStatement(nodes[1] as Syntax.ElseIfStatement)
		return nodes[0] as Syntax.IfStatement
	},

	[Production.ELSE_STMT]: function(nodes, width): Syntax.ElseStatement {
		return new Syntax.ElseStatement(nodes[0].start, width, nodes[2] as Syntax.Block)
	},

	[Production.ELIF_STMT]: function(nodes, width): Syntax.ElseIfStatement {
		return new Syntax.ElseIfStatement(
			nodes[0].start,
			width,
			nodes[2] as Syntax.Expression,
			nodes[5] as Syntax.Block
		)
	},

	[Production.COND_STMT]: function(nodes): Syntax.IfStatement {
		if (nodes[1] && (nodes[1] as Syntax.Node).kind === Syntax.Kind.ElseStatement) {
			;(nodes[0] as Syntax.IfStatement).setElseStatement(nodes[1] as Syntax.ElseStatement)
		}

		nodes[0].token = Production.COND_STMT
		return nodes[0] as Syntax.IfStatement
	},

	[Production.IMMUT_PARAM]: function(nodes, width): Syntax.Parameter {
		return new Syntax.Parameter(nodes[0].start, width, true, nodes[0] as Syntax.Type, nodes[1] as Syntax.Identifier)
	},

	[Production.MUT_PARAM]: function(nodes, width): Syntax.Parameter {
		;(nodes[1] as Syntax.Parameter).setMutable()
		nodes[1].width = width
		return nodes[1] as Syntax.Parameter
	},

	[Production.PARAM]: function(nodes): Syntax.Parameter {
		nodes[0].token = Production.PARAM
		return nodes[0] as Syntax.Parameter
	},

	[Production.PARAM_TAIL]: function(nodes): Syntax.Parameter {
		nodes[1].token = Production.PARAM_TAIL
		return nodes[1] as Syntax.Parameter
	},

	[Production.PARAMS]: function(nodes): Syntax.EphemeralParameterList {
		if (nodes[1]) {
			;(nodes[0] as Syntax.EphemeralParameterList).add(nodes[1] as Syntax.Parameter)
			return nodes[0] as Syntax.EphemeralParameterList
		}

		return new Syntax.EphemeralParameterList(nodes[0] as Syntax.Parameter)
	},

	[Production.FUNC_DEC_STMT]: function(nodes, width): Syntax.FunctionDeclarationStatement {
		let params: Array<Syntax.Parameter> = []

		if (nodes[3].token !== Lang.Token.Punctuation.CLOSE_PAREN) {
			params = (nodes.splice(3, 1)[0] as Syntax.EphemeralParameterList).parameters
		}

		return new Syntax.FunctionDeclarationStatement(
			nodes[0].start,
			width,
			nodes[1] as Syntax.Identifier,
			params,
			nodes[5] as Syntax.Type,
			nodes[7] as Syntax.Block
		)
	},

	[Production.ASSIGN_EXPR]: function(nodes, width): Syntax.AssignmentExpression {
		return new Syntax.AssignmentExpression(
			nodes[0].start,
			width,
			nodes[0] as Syntax.Identifier,
			nodes[2] as Syntax.Expression
		)
	},

	[Production.ARGS]: function(nodes): Syntax.EphemeralArgumentList {
		// If we are adding an expression to a tail (dyad's), create a new list
		// if not we are adding a tail onto a list
		const args =
			nodes[0].token === Production.EXPR
				? new EphemeralArgumentList(nodes[0] as Syntax.Expression)
				: (nodes[0] as Syntax.EphemeralArgumentList)

		args.add(nodes[1] as Syntax.Expression)

		return args
	},

	[Production.ARG_TAIL]: function(nodes): Syntax.Expression {
		nodes[1].token = Production.ARG_TAIL
		return nodes[1] as Syntax.Expression
	},

	[Production.CALL_EXPR]: function(nodes, width): Syntax.CallExpression {
		let args: Array<Syntax.Expression> = []

		if (nodes[2].token === Production.EXPR) {
			args = [nodes[2] as Syntax.Expression]
		} else if (nodes[2].token === Production.ARGS) {
			args = (nodes[2] as Syntax.EphemeralArgumentList).args
		}

		return new Syntax.CallExpression(nodes[0].start, width, nodes[0] as Syntax.Identifier, args)
	},

	[Production.FUNC_EXPR]: function(nodes, width): Syntax.FunctionExpression {
		let params: Array<Syntax.Parameter> = []

		if (nodes[2].token !== Lang.Token.Punctuation.CLOSE_PAREN) {
			params = (nodes.splice(2, 1)[0] as Syntax.EphemeralParameterList).parameters
		}

		return new Syntax.FunctionExpression(
			nodes[0].start,
			width,
			params,
			nodes[4] as Syntax.Type,
			nodes[6] as Syntax.Block
		)
	},
}
