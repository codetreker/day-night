import type { InternalNode, Node } from "@xyflow/react";

type Assert<Value extends true> = Value;
type Equal<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2) ? true : false;
type Task = Node<{ title: string }, "task"> & { readonly extra: 1 };
type InternalTask = InternalNode<Task>;

type InternalBaseAssignment = Assert<InternalTask extends InternalNode ? true : false>;
type CustomNodeAssignment = Assert<InternalTask extends Task ? true : false>;
type CustomDataPreserved = Assert<Equal<InternalTask["data"]["title"], string>>;
type CustomDataAssignment = Assert<InternalTask["data"] extends Task["data"] ? true : false>;
type CustomDataReverseAssignment = Assert<Task["data"] extends InternalTask["data"] ? true : false>;
type CustomLiteralPreserved = Assert<Equal<InternalTask["extra"], 1>>;
type CustomTypePreserved = Assert<Equal<InternalTask["type"], "task">>;
type UndefinedSource = Omit<Task, "sourcePosition"> & { sourcePosition: undefined };
type UndefinedTarget = Omit<Task, "targetPosition"> & { targetPosition: undefined };
type UndefinedSourceRejected = Assert<UndefinedSource extends Task ? false : true>;
type UndefinedTargetRejected = Assert<UndefinedTarget extends Task ? false : true>;
