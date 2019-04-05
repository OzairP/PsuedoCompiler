import * as Lang from '../../../../language'
import { Production } from '../../transitions'
import { Expression } from './Expression'
import { Kind } from '../Node'
import { BinaryOperationExpression } from './BinaryOperationExpression'

export class BinaryOperationExpressionTail extends Expression<Kind.BinaryOperationExpression> {
	constructor(start: number, width: number, public operator: Lang.Token.Operator, public rhs: Expression) {
		super(Kind.BinaryOperationExpression, Production.BIN_OP_EXPR_TAIL, start, width)
	}

	public attach(lhs: Expression): BinaryOperationExpression {
		return new BinaryOperationExpression(lhs.start, lhs.width + this.width, this.operator, lhs, this.rhs)
	}
}
