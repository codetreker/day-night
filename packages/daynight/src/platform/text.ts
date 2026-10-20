export const isText = (value: unknown): value is string => typeof value === "string" && value.isWellFormed() && !value.includes("\0");

export const isNonemptyText = (value: unknown): value is string => isText(value) && /[^\p{White_Space}]/u.test(value);
